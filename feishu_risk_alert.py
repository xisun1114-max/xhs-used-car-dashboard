from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime
from pathlib import Path

import build_html_dashboard as builder
from risk_alert_data import ALERT_STATUSES, compute_risk_payload


ROOT = Path(__file__).resolve().parent
BASE = "https://open.feishu.cn/open-apis"
FEISHU_FREQUENCY_LIMIT_CODE = 11232
DEFAULT_GITHUB_PAGES_URL = "https://xisun1114-max.github.io/xhs-used-car-dashboard/risk-alert.html"


def load_env() -> None:
    env_path = ROOT / ".env"
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8-sig").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                key, value = line.split("=", 1)
                os.environ.setdefault(key.strip(), value.strip())


def feishu_signature(secret: str, timestamp: str) -> str:
    string_to_sign = f"{timestamp}\n{secret}"
    digest = hmac.new(string_to_sign.encode("utf-8"), b"", hashlib.sha256).digest()
    return base64.b64encode(digest).decode("utf-8")


def parse_feishu_response(raw: str) -> dict:
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return {"ok": False, "code": None, "msg": "non-json response", "data": None}
    code = data.get("code")
    return {
        "ok": code == 0,
        "code": code,
        "msg": data.get("msg", ""),
        "data": data.get("data"),
        "raw": data,
    }


def fmt_money(value: float | int | None, digits: int = 2) -> str:
    number = 0 if value is None else float(value)
    return f"¥{number:,.{digits}f}"


def filter_alert_records(records: list[dict]) -> list[dict]:
    filtered = [item for item in records if item.get("deliveryStatus") in ALERT_STATUSES]
    filtered.sort(
        key=lambda item: (
            float(item.get("actionCost") or -1),
            float(item.get("spend") or 0),
        ),
        reverse=True,
    )
    return filtered


def compute_alert_payload() -> dict:
    payload = compute_risk_payload(builder.load_data())
    records = filter_alert_records(payload["records"])
    active_status = ALERT_STATUSES[0]
    suspect_status = ALERT_STATUSES[1]
    status_counts = {
        active_status: sum(1 for item in records if item.get("deliveryStatus") == active_status),
        suspect_status: sum(1 for item in records if item.get("deliveryStatus") == suspect_status),
    }
    return {
        "records": records,
        "alert_count": len(records),
        "alert_spend": sum(float(item.get("spend") or 0) for item in records),
        "status_counts": status_counts,
        "active_status": active_status,
        "suspect_status": suspect_status,
    }


def resolve_public_risk_board_url(risk_board_url: str | None = None) -> str:
    value = (risk_board_url or "").strip()
    if value:
        return value
    value = os.environ.get("GITHUB_PAGES_RISK_ALERT_URL", "").strip()
    if value:
        return value
    value = os.environ.get("GITHUB_PAGES_SITE_URL", "").strip().rstrip("/")
    if value:
        return f"{value}/risk-alert.html"
    return DEFAULT_GITHUB_PAGES_URL


def build_summary_text(risk_board_url: str, fixed_now: str | None = None) -> dict:
    payload = compute_alert_payload()
    alert_count = payload["alert_count"]
    active_status = payload["active_status"]
    suspect_status = payload["suspect_status"]
    active_count = payload["status_counts"].get(active_status, 0)
    suspect_count = payload["status_counts"].get(suspect_status, 0)
    if alert_count == 0 or active_count == 0:
        payload["should_send"] = False
        payload["summary_text"] = ""
        return payload

    timestamp_text = fixed_now or datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    payload["should_send"] = True
    payload["public_url"] = risk_board_url
    payload["summary_text"] = "\n".join(
        [
            "【转转二手车-高成本预警】投放中/疑似拉停发现异常笔记",
            f"发送时间：{timestamp_text}",
            f"预警总数：{alert_count} 条",
            f"状态分布：投放中 {active_count} 条 / 疑似拉停 {suspect_count} 条",
            f"预警总消耗：{fmt_money(payload['alert_spend'])}",
            "以下笔记命中高成本预警，请投放同学优先排查投放策略、素材承接和组件点击表现。",
            "底部操作：",
            f"• 打开高成本预警看板：{risk_board_url}",
        ]
    )
    return payload


def tenant_access_token() -> str:
    app_id = os.environ.get("FEISHU_APP_ID", "").strip()
    app_secret = os.environ.get("FEISHU_APP_SECRET", "").strip()
    if not app_id or not app_secret:
        raise RuntimeError("Missing FEISHU_APP_ID or FEISHU_APP_SECRET")
    request = urllib.request.Request(
        f"{BASE}/auth/v3/tenant_access_token/internal",
        data=json.dumps({"app_id": app_id, "app_secret": app_secret}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.loads(response.read().decode("utf-8"))
    token = payload.get("tenant_access_token")
    if payload.get("code") != 0 or not token:
        raise RuntimeError(f"Failed to get tenant token: {payload}")
    return token


def open_api(method: str, path: str, token: str, body: dict | None = None, headers: dict | None = None) -> dict:
    request_headers = {"Authorization": f"Bearer {token}"}
    if headers:
        request_headers.update(headers)
    data = None
    if body is not None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        request_headers.setdefault("Content-Type", "application/json")
    request = urllib.request.Request(f"{BASE}{path}", data=data, headers=request_headers, method=method)
    with urllib.request.urlopen(request, timeout=60) as response:
        raw = response.read().decode("utf-8")
    return json.loads(raw)


def send_app_text_message(chat_id: str, text: str) -> dict:
    token = tenant_access_token()
    return open_api(
        "POST",
        "/im/v1/messages?receive_id_type=chat_id",
        token,
        body={
            "receive_id": chat_id,
            "msg_type": "text",
            "content": json.dumps({"text": text}, ensure_ascii=False),
        },
        headers={"uuid": str(uuid.uuid4())},
    )


def send_webhook_text(body: dict, webhook: str, secret: str) -> dict:
    max_attempts = 4
    backoff_seconds = [2, 5, 10]
    last_result = None
    send_body = dict(body)
    if secret:
        timestamp = str(int(time.time()))
        send_body["timestamp"] = timestamp
        send_body["sign"] = feishu_signature(secret, timestamp)
    for attempt in range(1, max_attempts + 1):
        request = urllib.request.Request(
            webhook,
            data=json.dumps(send_body, ensure_ascii=False).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                raw = response.read().decode("utf-8", errors="replace")
            parsed = parse_feishu_response(raw)
            last_result = {
                "sent": parsed["ok"],
                "response": raw[:1000],
                "code": parsed["code"],
                "msg": parsed["msg"],
                "attempts": attempt,
            }
            if parsed["ok"]:
                return last_result
            if parsed["code"] != FEISHU_FREQUENCY_LIMIT_CODE or attempt == max_attempts:
                return last_result
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode("utf-8", errors="replace")
            return {
                "sent": False,
                "error": f"HTTP {exc.code}",
                "response": raw[:1000],
                "attempts": attempt,
            }
        except Exception as exc:
            return {"sent": False, "error": str(exc), "attempts": attempt}
        time.sleep(backoff_seconds[attempt - 1])
    return last_result or {"sent": False, "error": "unknown error"}


def send_risk_alert(risk_board_url: str, report_path: str) -> dict:
    del report_path
    load_env()

    public_url = resolve_public_risk_board_url(risk_board_url)
    payload = build_summary_text(public_url)
    if not payload["should_send"]:
        return {
            "configured": True,
            "sent": False,
            "skipped": True,
            "message": "No active high-cost risk alerts to send",
            "alert_count": 0,
            "alert_spend": 0,
            "status_counts": payload["status_counts"],
            "public_url": public_url,
        }

    chat_id = os.environ.get("FEISHU_RISK_ALERT_CHAT_ID", "").strip()
    webhook = os.environ.get("FEISHU_RISK_ALERT_WEBHOOK_URL", "").strip()
    webhook_secret = os.environ.get("FEISHU_RISK_ALERT_WEBHOOK_SECRET", "").strip()
    summary_body = {"msg_type": "text", "content": {"text": payload["summary_text"]}}

    result = {
        "configured": bool(chat_id or webhook),
        "sent": False,
        "alert_count": payload["alert_count"],
        "alert_spend": payload["alert_spend"],
        "status_counts": payload["status_counts"],
        "summary_text": payload["summary_text"],
        "public_url": public_url,
    }

    if chat_id:
        try:
            text_result = send_app_text_message(chat_id, payload["summary_text"])
            result.update(
                {
                    "sent": True,
                    "delivery": "app_bot",
                    "chat_id": chat_id,
                    "text_message": text_result,
                }
            )
            return result
        except Exception as exc:
            result.update(
                {
                    "delivery": "app_bot",
                    "chat_id": chat_id,
                    "error": str(exc),
                }
            )
            return result

    if webhook:
        webhook_result = send_webhook_text(summary_body, webhook, webhook_secret)
        result.update({"delivery": "webhook", "webhook_message": webhook_result, "sent": bool(webhook_result.get("sent"))})
        return result

    result.update({"message": "Neither FEISHU_RISK_ALERT_CHAT_ID nor FEISHU_RISK_ALERT_WEBHOOK_URL is configured"})
    return result


if __name__ == "__main__":
    load_env()
    print(
        json.dumps(
            send_risk_alert(
                risk_board_url=resolve_public_risk_board_url(),
                report_path="",
            ),
            ensure_ascii=True,
            indent=2,
        )
    )
