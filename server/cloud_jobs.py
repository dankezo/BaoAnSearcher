"""Local-only controls for the repository's GitHub-hosted crawler."""
import json
import subprocess
import threading
import time
from datetime import datetime, timezone
from .common import DATA_DIR

REPO = 'dankezo/BaoAnSearcher'
WORKFLOW = 'daily-crawl.yml'
_lock = threading.Lock()
_transfer = {'state': 'idle', 'message': ''}
_github_status = (0, {})
_transfer_path = DATA_DIR / 'cloud_pull.json'
try:
    _transfer = json.loads(_transfer_path.read_text(encoding='utf-8'))
    if not isinstance(_transfer, dict):
        _transfer = {'state': 'idle', 'message': ''}
    if _transfer.get('state') == 'running':
        _transfer.update(state='error', message='Lượt tải trước bị gián đoạn; bấm tải lại để tiếp tục.')
except (OSError, ValueError):
    pass


def github(*args):
    result = subprocess.run(['gh', *args], capture_output=True, text=True, encoding='utf-8',
                            timeout=25, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if result.returncode:
        raise RuntimeError('GitHub chưa sẵn sàng. Kiểm tra gh auth login và workflow daily-crawl.yml trên nhánh mặc định.')
    return json.loads(result.stdout) if result.stdout.strip() else {}


def status():
    global _github_status
    if time.time() - _github_status[0] < 30:
        return dict(_github_status[1], transfer=dict(_transfer))
    try:
        workflow = github('api', f'repos/{REPO}/actions/workflows/{WORKFLOW}')
        runs = github('api', f'repos/{REPO}/actions/workflows/{WORKFLOW}/runs?per_page=1')
        latest = next(iter(runs.get('workflow_runs') or []), {})
        value = {'available': True, 'enabled': workflow.get('state') == 'active',
                'schedule': '05:17 hằng ngày (giờ Việt Nam)',
                'run': {key: latest.get(key) for key in ('status', 'conclusion', 'html_url', 'created_at')},
                'transfer': dict(_transfer)}
    except (RuntimeError, OSError, subprocess.TimeoutExpired):
        value = {'available': False, 'enabled': False, 'message': 'Chưa kết nối lịch cloud. Cần GitHub CLI đăng nhập và workflow đã cài.', 'transfer': dict(_transfer)}
    _github_status = (time.time(), value)
    return value


def control(action):
    global _github_status
    if action not in ('enable', 'disable', 'run'):
        raise ValueError('Thao tác cloud không hợp lệ.')
    endpoint = 'dispatches' if action == 'run' else action
    args = ['api', '--method', 'POST' if action == 'run' else 'PUT', f'repos/{REPO}/actions/workflows/{WORKFLOW}/{endpoint}']
    if action == 'run':
        repo = github('api', f'repos/{REPO}')
        args.extend(['-f', f"ref={repo['default_branch']}"])
    github(*args)
    _github_status = (0, {})
    return {'ok': True, 'message': {'enable': 'Đã bật lịch crawl cloud.', 'disable': 'Đã tắt lịch crawl cloud.', 'run': 'Đã gửi lượt crawl lên cloud; máy local có thể tắt.'}[action]}


def pull():
    global _transfer
    if not _lock.acquire(blocking=False):
        return {'ok': False, 'message': 'Đang tải dữ liệu online về local.'}

    # Publish the new run before returning, so a retry cannot see an old error.
    _transfer = {'state':'running','message':'Đang tải DAV, MSC và VSS từ TiDB về local…','startedAt':datetime.now(timezone.utc).isoformat()}
    def work():
        global _transfer
        try:
            from scripts.tidb.pull_to_local import pull_all
            counts = pull_all(production_standard=True)
            if counts.get('_canonical_ready'):
                from scripts.tidb.connect import connect,require_config
                from scripts.tidb.company_profiles import verify_baseline,mirror
                connection=connect(require_config())
                try:
                    counts['_canonical']=verify_baseline(connection)
                    try:counts['_company_profiles']=len(mirror(connection))
                    except Exception:counts['_company_profiles']=0
                finally:connection.close()
            partial = bool(counts.get('_errors'))
            _transfer = {'state': 'partial' if partial else 'idle', 'message': 'Đã nhập một phần; xem các nguồn chưa hoàn tất.' if partial else 'Đã nhập DAV, MSC và VSS về local.', 'counts': counts}
        except Exception:
            _transfer = {'state': 'error', 'message': 'Tải chưa hoàn tất. Dữ liệu đã nhập được giữ lại; có thể chạy tiếp.'}
        finally:
            from .analytics import clear_cache, warm_overview
            clear_cache()
            warm_overview()
            try:
                _transfer_path.parent.mkdir(parents=True, exist_ok=True)
                _transfer_path.write_text(json.dumps(_transfer, ensure_ascii=False), encoding='utf-8')
            except OSError:
                pass
            _lock.release()

    threading.Thread(target=work, daemon=True, name='cloud-to-local').start()
    return {'ok': True, 'message': 'Đã bắt đầu tải dữ liệu online về local.'}
