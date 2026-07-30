from __future__ import annotations

import argparse
import json
import re
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path

import pandas as pd


MONITOR_START = date(2026, 6, 1)
SUPPLIER = "\u4f9b\u5e94\u5546"


def clean_note_id(value: object) -> str:
    text = "" if value is None or pd.isna(value) else str(value).strip().lower()
    match = re.search(r"([0-9a-f]{24})", text)
    return match.group(1) if match else text.removesuffix(".0")


def as_number(value: object) -> float:
    if value is None or pd.isna(value):
        return 0.0
    try:
        return float(str(value).replace(",", "").replace("%", "").strip())
    except ValueError:
        return 0.0


def locate_spotlight_book(source_root: Path) -> Path:
    candidates = [
        path
        for path in source_root.glob("*.xlsx")
        if 4_000_000 <= path.stat().st_size <= 6_000_000
    ]
    if not candidates:
        raise FileNotFoundError("Could not locate the Spotlight source workbook")
    return max(candidates, key=lambda path: path.stat().st_mtime)


def load_pgy_history(snapshot_root: Path):
    history: dict[str, dict[date, dict]] = defaultdict(dict)
    latest_snapshot_day: date | None = None
    for snapshot_dir in sorted(path for path in snapshot_root.iterdir() if path.is_dir()):
        csv_path = snapshot_dir / "pugongying_snapshot.csv"
        if not csv_path.exists():
            continue
        snapshot_day = datetime.strptime(snapshot_dir.name, "%Y%m%d").date()
        latest_snapshot_day = max(latest_snapshot_day or snapshot_day, snapshot_day)
        frame = pd.read_csv(csv_path, encoding="utf-8-sig", dtype={"note_id": str})
        for row in frame.to_dict("records"):
            note_id = clean_note_id(row.get("note_id"))
            effective = pd.to_datetime(row.get("data_update_date"), errors="coerce")
            if not note_id or pd.isna(effective):
                continue
            effective_day = effective.date()
            record = {
                "snapshot_day": snapshot_day,
                "comments": int(round(as_number(row.get("comments")))),
                "title": str(row.get("note_title") or "").strip(),
                "nickname": str(row.get("creator_name") or "").strip(),
                "link": str(row.get("note_url") or "").strip(),
                "publish_date": pd.to_datetime(row.get("note_published_at"), errors="coerce"),
            }
            existing = history[note_id].get(effective_day)
            if existing is None or snapshot_day >= existing["snapshot_day"]:
                history[note_id][effective_day] = record
    if not history:
        raise RuntimeError("No Pugongying snapshots found")
    effective_day = max(day for records in history.values() for day in records)
    return history, effective_day, latest_snapshot_day


def comment_delta(records: dict[date, dict], effective_day: date, days: int) -> int | None:
    current = records.get(effective_day)
    if current is None:
        return None
    target = effective_day - timedelta(days=days)
    if target in records:
        return max(0, current["comments"] - records[target]["comments"])
    later = sorted(day for day in records if target < day < effective_day)
    if later:
        return max(0, current["comments"] - records[later[0]]["comments"])
    return None


def percentile_rank(series: pd.Series) -> pd.Series:
    if series.empty:
        return pd.Series(dtype=float)
    return series.rank(method="max", pct=True).fillna(0.0)


def build_payload(source_root: Path, run_day: date) -> dict:
    book = locate_spotlight_book(source_root)
    raw_spotlight = pd.read_excel(book, sheet_name=0, dtype={11: str})
    raw_notes = pd.read_excel(book, sheet_name=1, dtype={8: str})

    spotlight = pd.DataFrame(
        {
            "note_id": raw_spotlight.iloc[:, 11].map(clean_note_id),
            "day": pd.to_datetime(raw_spotlight.iloc[:, 5], errors="coerce").dt.date,
            "spend": pd.to_numeric(raw_spotlight.iloc[:, 17], errors="coerce").fillna(0.0),
            "action_clicks": pd.to_numeric(raw_spotlight.iloc[:, 25], errors="coerce").fillna(0.0),
        }
    )
    spotlight = spotlight[spotlight["note_id"].ne("") & spotlight["day"].notna()].copy()
    spotlight_day = max(spotlight["day"])

    supplier = raw_notes[raw_notes.iloc[:, 0].astype(str).str.strip().eq(SUPPLIER)].copy()
    supplier["note_id"] = supplier.iloc[:, 8].map(clean_note_id)
    supplier["publish_date"] = pd.to_datetime(supplier.iloc[:, 2], errors="coerce").dt.date
    supplier = supplier[
        supplier["note_id"].ne("")
        & supplier["publish_date"].notna()
        & (supplier["publish_date"] >= MONITOR_START)
    ]
    note_meta = {
        row["note_id"]: {
            "publish_date": row["publish_date"],
            "nickname": str(row.iloc[6] or "").strip(),
            "link": str(row.iloc[7] or "").strip(),
        }
        for _, row in supplier.iterrows()
    }

    grouped = (
        spotlight[spotlight["note_id"].isin(note_meta)]
        .groupby(["note_id", "day"], as_index=False)
        .agg(spend=("spend", "sum"), action_clicks=("action_clicks", "sum"))
    )
    delivery = {}
    for note_id, frame in grouped.groupby("note_id"):
        recent3 = frame[frame["day"] >= spotlight_day - timedelta(days=2)]
        recent7 = frame[frame["day"] >= spotlight_day - timedelta(days=6)]
        delivery[note_id] = {
            "spend_3d": float(recent3["spend"].sum()),
            "spend_7d": float(recent7["spend"].sum()),
            "spend_total": float(frame["spend"].sum()),
            "active_days_7d": int(recent7.loc[recent7["spend"] > 0, "day"].nunique()),
            "action_clicks_3d": int(round(recent3["action_clicks"].sum())),
        }

    history, pgy_day, latest_snapshot_day = load_pgy_history(
        source_root / "work" / "xhs_source_snapshots"
    )
    rows = []
    for note_id, meta in note_meta.items():
        records = history.get(note_id, {})
        latest = records.get(pgy_day) or (records[max(records)] if records else {})
        delivery_row = delivery.get(note_id, {})
        rows.append(
            {
                "note_id": note_id,
                "title": latest.get("title") or "供应商笔记",
                "nickname": meta["nickname"] or latest.get("nickname", ""),
                "link": meta["link"] or latest.get("link") or f"https://www.xiaohongshu.com/explore/{note_id}",
                "publish_date": meta["publish_date"].isoformat(),
                "spend_3d": round(delivery_row.get("spend_3d", 0.0), 2),
                "spend_7d": round(delivery_row.get("spend_7d", 0.0), 2),
                "spend_total": round(delivery_row.get("spend_total", 0.0), 2),
                "active_days_7d": delivery_row.get("active_days_7d", 0),
                "action_clicks_3d": delivery_row.get("action_clicks_3d", 0),
                "comments_total": int(latest.get("comments", 0)),
                "comments_3d": comment_delta(records, pgy_day, 3),
                "comments_7d": comment_delta(records, pgy_day, 7),
            }
        )

    frame = pd.DataFrame(rows)
    frame["spend_rank"] = percentile_rank(frame["spend_3d"])
    frame["comment_rank"] = percentile_rank(frame["comments_total"])
    top_spend_ids = set(frame.nlargest(10, "spend_3d").loc[lambda x: x["spend_3d"] > 0, "note_id"])
    top_comment_ids = set(frame.nlargest(10, "comments_total").loc[lambda x: x["comments_total"] > 0, "note_id"])

    tasks = []
    for row in frame.to_dict("records"):
        comments3 = row["comments_3d"] or 0
        comments7 = row["comments_7d"] or 0
        p0_reasons = []
        if row["spend_3d"] >= 100:
            p0_reasons.append("近3日聚光消费≥100元")
        if row["note_id"] in top_spend_ids:
            p0_reasons.append("近3日消费排名前10")
        if row["comments_total"] >= 30:
            p0_reasons.append("累计评论≥30条")
        if row["note_id"] in top_comment_ids:
            p0_reasons.append("累计评论排名前10")
        if comments3 >= 3:
            p0_reasons.append("近3日新增评论≥3条")
        if row["spend_3d"] >= 50 and row["comments_total"] >= 20:
            p0_reasons.append("高消耗且高评论")

        priority = None
        reasons = p0_reasons
        cadence_days = 1
        if p0_reasons:
            priority = "P0"
        elif row["spend_3d"] >= 20 or comments3 >= 1 or row["spend_7d"] >= 100:
            priority = "P1"
            cadence_days = 3
            reasons = []
            if row["spend_3d"] >= 20:
                reasons.append("近3日仍有较高消耗")
            if comments3 >= 1:
                reasons.append("近3日评论仍增长")
            if row["spend_7d"] >= 100:
                reasons.append("近7日聚光消费≥100元")
        elif row["comments_total"] >= 20 and row["spend_7d"] == 0 and comments7 == 0:
            priority = "P2"
            cadence_days = 7
            reasons = ["高累计评论停投笔记每7日巡检"]
        if priority is None:
            continue

        spend_score = min(35, round(35 * row["spend_rank"]))
        total_comment_score = min(20, round(20 * row["comment_rank"]))
        growth_score = min(20, comments3 * 5)
        active_score = min(10, row["active_days_7d"] * 2)
        combined_bonus = 10 if row["spend_3d"] >= 50 and row["comments_total"] >= 20 else 0
        score = min(100, spend_score + total_comment_score + growth_score + active_score + combined_bonus)
        tasks.append(
            {
                **{key: row[key] for key in [
                    "note_id", "title", "nickname", "link", "publish_date",
                    "spend_3d", "spend_7d", "spend_total", "active_days_7d",
                    "action_clicks_3d", "comments_total", "comments_3d", "comments_7d",
                ]},
                "task_id": f"{row['note_id']}:{run_day.isoformat()}:1",
                "task_date": run_day.isoformat(),
                "priority": priority,
                "score": score,
                "cadence_days": cadence_days,
                "reasons": reasons,
                "cycle_number": 1,
                "status": "pending",
                "owner": "",
                "review_done": False,
                "placement_done": False,
                "dealer_guard_done": False,
                "reply_done": False,
                "recheck_done": False,
                "placement_count": 0,
                "risk_tag": "",
                "notes": "",
                "version": 1,
            }
        )

    priority_order = {"P0": 0, "P1": 1, "P2": 2}
    tasks.sort(key=lambda row: (priority_order[row["priority"]], -row["score"], -row["spend_3d"], -row["comments_total"]))
    counts = {level: sum(task["priority"] == level for task in tasks) for level in priority_order}
    return {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "task_date": run_day.isoformat(),
        "data_freshness": {
            "spotlight_as_of": spotlight_day.isoformat(),
            "pgy_as_of": pgy_day.isoformat(),
            "pgy_snapshot_as_of": latest_snapshot_day.isoformat() if latest_snapshot_day else None,
        },
        "scope": {
            "category": SUPPLIER,
            "published_since": MONITOR_START.isoformat(),
            "eligible_notes": len(frame),
        },
        "thresholds": {
            "p0_spend_3d": 100,
            "p0_comments_total": 30,
            "p0_comments_3d": 3,
            "p0_top_n_spend": 10,
            "p0_top_n_comments": 10,
            "p1_spend_3d": 20,
            "p1_spend_7d": 100,
            "p2_comments_total": 20,
        },
        "summary": {"total": len(tasks), **{level.lower(): count for level, count in counts.items()}},
        "tasks": tasks,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--run-date", type=date.fromisoformat, default=date.today())
    args = parser.parse_args()
    payload = build_payload(args.source_root.resolve(), args.run_date)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"output": str(args.output), **payload["summary"], **payload["data_freshness"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
