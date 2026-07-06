import base64
import hashlib
import hmac
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ENV_PATH = ROOT / ".env"
LOG_DIR = ROOT / "publish_run_logs"
DASHBOARD_ID = "zhuanzhuan_xhs_ads"
DASHBOARD_NAME = "转转二手车-聚光投流看板"
FEISHU_FREQUENCY_LIMIT_CODE = 11232


def load_env():
    if ENV_PATH.exists():
        for line in ENV_PATH.read_text(encoding="utf-8-sig").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                key, value = line.split("=", 1)
                os.environ.setdefault(key.strip(), value.strip())


def run_step(command, timeout):
    result = subprocess.run(
        command,
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    return {
        "command": command,
        "returncode": result.returncode,
        "stdout": result.stdout,
        "stderr": result.stderr,
    }


def verify_online(url):
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 CodexDashboardPublisher/1.0",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        method="GET",
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        body = response.read()
    text = body.decode("utf-8", errors="replace")
    return {
        "url": url,
        "bytes": len(body),
        "has_dashboard_title": ("转转二手车" in text) or ("小红书" in text),
        "has_copy_button": "复制" in text,
        "has_open_button": "打开" in text,
        "has_bad_formula": "XLOOKUP(" in text,
        "has_bad_cell_object": "cellPosition" in text,
    }


def verify_with_retry(verify_fn, url, attempts=2, delay_seconds=5):
    last_error = None
    for attempt in range(1, attempts + 1):
        try:
            result = verify_fn(url)
            result["verified"] = True
            result["attempts"] = attempt
            return result
        except Exception as exc:
            last_error = {
                "url": url,
                "verified": False,
                "attempts": attempt,
                "error": str(exc),
            }
            if attempt < attempts:
                time.sleep(delay_seconds)
    return last_error or {"url": url, "verified": False, "attempts": 0, "error": "unknown verify error"}


def cloudflare_api_json(path, timeout=60):
    token = os.environ.get("CLOUDFLARE_API_TOKEN", "").strip()
    account_id = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "").strip()
    if not token or not account_id:
        raise RuntimeError("Missing Cloudflare API credentials for fallback verification")
    base = f"https://api.cloudflare.com/client/v4/accounts/{account_id}"
    request = urllib.request.Request(
        urllib.parse.urljoin(base + "/", path.lstrip("/")),
        headers={"Authorization": f"Bearer {token}"},
        method="GET",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        payload = json.loads(response.read().decode("utf-8"))
    if payload.get("success") is False:
        raise RuntimeError(f"Cloudflare API verify failed: {payload}")
    return payload.get("result") or payload


def verify_online_via_cloudflare_api(upload_payload):
    worker_name = (upload_payload or {}).get("worker_name") or os.environ.get("CLOUDFLARE_WORKER_NAME", "").strip()
    expected_version = (upload_payload or {}).get("version_id")
    expected_deployment = (upload_payload or {}).get("deployment_id")
    uploaded_files = set((upload_payload or {}).get("uploaded_files") or [])
    deployments = cloudflare_api_json(f"workers/scripts/{worker_name}/deployments").get("deployments", [])
    worker = cloudflare_api_json(f"workers/workers/{worker_name}")
    version = cloudflare_api_json(f"workers/workers/{worker_name}/versions/{expected_version}") if expected_version else {}
    latest = deployments[0] if deployments else {}
    latest_versions = latest.get("versions") or []
    latest_version = latest_versions[0].get("version_id") if latest_versions else ""
    latest_percentage = latest_versions[0].get("percentage") if latest_versions else None
    required_files = {"index.html", "XHS.html", "dashboard_runtime.js", "dashboard_runtime_patch.js", "xlsx.full.min.js"}
    return {
        "method": "cloudflare_api",
        "verified": True,
        "worker_name": worker_name,
        "deployment_id_matches": bool(expected_deployment and latest.get("id") == expected_deployment),
        "version_id_matches": bool(expected_version and latest_version == expected_version),
        "latest_deployment_id": latest.get("id"),
        "latest_version_id": latest_version,
        "latest_version_percentage": latest_percentage,
        "subdomain_enabled": bool(((worker.get("subdomain") or {}).get("enabled"))),
        "assets_binding_present": any(binding.get("type") == "assets" and binding.get("name") == "ASSETS" for binding in (version.get("bindings") or [])),
        "uploaded_files_present": sorted(uploaded_files),
        "required_files_present": sorted(required_files.intersection(uploaded_files)),
        "required_files_missing": sorted(required_files - uploaded_files),
        "version_created_on": version.get("created_on"),
        "worker_deployed_on": worker.get("deployed_on"),
    }


def latest_report_path():
    report_root = ROOT / "publish_reports"
    if not report_root.exists():
        return ""
    reports = [path for path in report_root.iterdir() if path.is_dir()]
    if not reports:
        return ""
    latest = max(reports, key=lambda path: path.stat().st_mtime)
    report = latest / "publish_report.md"
    return str(report if report.exists() else latest)


def latest_current_state(report_path):
    if not report_path:
        return {}
    quality_path = Path(report_path).with_name("quality_report.json")
    if not quality_path.exists():
        return {}
    return json.loads(quality_path.read_text(encoding="utf-8")).get("current_state", {})


def write_run_log(payload):
    LOG_DIR.mkdir(exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    log_path = LOG_DIR / f"dashboard-auto-publish-{stamp}.json"
    log_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return log_path


def record_success_state(payload):
    current_state = payload.get("current_state") or {}
    if not current_state:
        return ""
    state_path = ROOT / "dashboard_publish_state" / f"{DASHBOARD_ID}_last_success.json"
    cloudflare = payload.get("cloudflare") or {}
    state = dict(current_state)
    state.update({
        "dashboard_id": DASHBOARD_ID,
        "dashboard_name": DASHBOARD_NAME,
        "baseline_report": payload.get("report_path", ""),
        "baseline_recorded_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "cloudflare_version_id": cloudflare.get("version_id"),
        "cloudflare_deployment_id": cloudflare.get("deployment_id"),
    })
    state_path.parent.mkdir(exist_ok=True)
    state_path.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    return str(state_path)


def feishu_signature(secret, timestamp):
    string_to_sign = f"{timestamp}\n{secret}"
    digest = hmac.new(string_to_sign.encode("utf-8"), b"", hashlib.sha256).digest()
    return base64.b64encode(digest).decode("utf-8")


def parse_feishu_response(raw):
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
    }


def send_feishu_message(title, payload, log_path):
    webhook = os.environ.get("FEISHU_WEBHOOK_URL", "").strip()
    if not webhook:
        return {"configured": False, "sent": False, "message": "FEISHU_WEBHOOK_URL is not configured"}

    status = payload.get("status", "UNKNOWN")
    report_path = payload.get("report_path") or latest_report_path()
    cloudflare = payload.get("cloudflare") or {}
    online = payload.get("online") or {}
    current_state = payload.get("current_state") or {}
    status_label = {
        "PASS": "成功",
        "BLOCKED": "已拦截",
        "NEEDS_MANUAL_REVIEW": "需要人工确认",
        "FAILED": "失败",
        "TEST": "测试",
    }.get(status, status)
    result_label = "已上传 Cloudflare，并完成线上校验" if status == "PASS" else payload.get("message", "")
    if status in ("BLOCKED", "NEEDS_MANUAL_REVIEW", "FAILED"):
        result_label = f"{payload.get('message', '')} 线上看板保持上一版。"
    text = "\n".join([
        title,
        "",
        f"状态：{status_label}",
        f"时间：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        f"看板日期：{current_state.get('date_min', '-')} 至 {current_state.get('date_max', '-')}",
        f"数据行数：{current_state.get('row_count', '-')}",
        f"发布结果：{result_label}",
        f"异常说明：{payload.get('message', '无') if status != 'PASS' else payload.get('note', '无')}",
        "",
        f"线上看板：{cloudflare.get('url') or online.get('url') or os.environ.get('CLOUDFLARE_WORKER_URL', '')}",
        f"发布报告：{report_path}",
        f"运行日志：{log_path}",
    ])
    body = {"msg_type": "text", "content": {"text": text}}
    secret = os.environ.get("FEISHU_WEBHOOK_SECRET", "").strip()
    if secret:
        timestamp = str(int(time.time()))
        body["timestamp"] = timestamp
        body["sign"] = feishu_signature(secret, timestamp)
    max_attempts = 4
    backoff_seconds = [2, 5, 10]
    last_result = None
    for attempt in range(1, max_attempts + 1):
        request = urllib.request.Request(
            webhook,
            data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                raw = response.read().decode("utf-8", errors="replace")
            parsed = parse_feishu_response(raw)
            last_result = {
                "configured": True,
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
                "configured": True,
                "sent": False,
                "error": f"HTTP {exc.code}",
                "response": raw[:1000],
                "attempts": attempt,
            }
        except Exception as exc:
            return {"configured": True, "sent": False, "error": str(exc), "attempts": attempt}

        time.sleep(backoff_seconds[attempt - 1])

    return last_result or {"configured": True, "sent": False, "error": "unknown error"}


def finish(payload):
    payload["report_path"] = payload.get("report_path") or latest_report_path()
    if not payload.get("current_state"):
        payload["current_state"] = latest_current_state(payload["report_path"])
    if payload.get("status") == "PASS":
        payload["success_state_path"] = record_success_state(payload)
        pages_build = run_step([sys.executable, str(ROOT / "build_github_pages_site.py")], timeout=1200)
        payload["risk_pages_site"] = {
            "built": pages_build["returncode"] == 0,
            "stdout_tail": pages_build["stdout"][-2000:],
            "stderr_tail": pages_build["stderr"][-2000:],
            "path": str((ROOT / "github-pages-site").resolve()),
        }
    log_path = write_run_log(payload)
    title = "【转转二手车-聚光投流看板】自动发布提醒"
    payload["run_log"] = str(log_path)
    payload["feishu_notification"] = send_feishu_message(title, payload, log_path)
    log_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return payload


def main():
    load_env()
    fetch = run_step([sys.executable, str(ROOT / "feishu_fetch_dry_run.py")], timeout=1200)
    if fetch["returncode"] != 0:
        finish({
            "status": "BLOCKED",
            "stage": "fetch_generate_quality",
            "message": "质量门禁未通过，已停止，未上传 Cloudflare。",
            "stdout_tail": fetch["stdout"][-4000:],
            "stderr_tail": fetch["stderr"][-4000:],
        })
        raise SystemExit(fetch["returncode"])

    upload = run_step([sys.executable, str(ROOT / "cloudflare_worker_upload.py")], timeout=1200)
    if upload["returncode"] != 0:
        finish({
            "status": "FAILED",
            "stage": "cloudflare_upload",
            "message": "质量门禁已通过，但 Cloudflare 上传失败。",
            "stdout_tail": upload["stdout"][-4000:],
            "stderr_tail": upload["stderr"][-4000:],
        })
        raise SystemExit(upload["returncode"])

    upload_payload = json.loads(upload["stdout"])
    report_path = latest_report_path()
    online = verify_with_retry(verify_online, upload_payload["url"])
    public_online_ok = (
        online.get("verified")
        and online["bytes"] > 1000000
        and online["has_dashboard_title"]
        and online["has_copy_button"]
        and online["has_open_button"]
        and not online["has_bad_formula"]
        and not online["has_bad_cell_object"]
    )
    api_online = None
    if not public_online_ok:
        api_online = verify_online_via_cloudflare_api(upload_payload)
    api_online_ok = bool(
        api_online
        and api_online.get("verified")
        and api_online.get("deployment_id_matches")
        and api_online.get("version_id_matches")
        and api_online.get("latest_version_percentage") == 100
        and api_online.get("subdomain_enabled")
        and api_online.get("assets_binding_present")
        and not api_online.get("required_files_missing")
    )
    online_ok = public_online_ok or api_online_ok
    finish({
        "status": "PASS" if online_ok else "FAILED",
        "stage": "online_verification",
        "message": (
            ("看板已自动上传 Cloudflare，并完成公网线上校验。" if public_online_ok else "看板已自动上传 Cloudflare，公网 workers.dev 从当前环境不可达，已改用 Cloudflare API 完成发布校验。")
            if online_ok
            else "Cloudflare 已上传，但线上校验未通过。"
        ),
        "fetch_stdout_tail": fetch["stdout"][-2000:],
        "current_state": latest_current_state(report_path),
        "report_path": report_path,
        "cloudflare": upload_payload,
        "online": online,
        "api_online": api_online,
    })
    raise SystemExit(0 if online_ok else 3)


if __name__ == "__main__":
    main()
