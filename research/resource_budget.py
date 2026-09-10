"""Opt-in server budget. Standard/local research does not use this supervisor."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time


def server_low():
    return os.environ.get('FACTOR_RESEARCH_PROFILE') == 'server-low'


def budget():
    # Explicit server opt-in, never inferred from OS or machine memory.
    return {'profile': 'server-low' if server_low() else 'standard',
            'panelDays': 90 if server_low() else 730,
            'panelRows': 12000 if server_low() else None,
            'inboxPackets': 10 if server_low() else None,
            'labelsPerHorizon': 2000 if server_low() else None}


def atomic(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + f'.{os.getpid()}.tmp')
    tmp.write_text(json.dumps(value, ensure_ascii=False), encoding='utf-8')
    os.replace(tmp, path)


def psi(text):
    return float(next(line for line in text.splitlines() if line.startswith('some ')).split('avg10=')[1].split()[0])


def snapshot(runtime, group=None):
    mem = dict(line.split(':', 1) for line in Path('/proc/meminfo').read_text().splitlines())
    health = json.loads((Path(runtime)/'service-status.json').read_text())
    def age(key):
        value = health.get(key)
        if not isinstance(value, str): return None
        try:
            stamp = datetime.fromisoformat(value.replace('Z', '+00:00'))
            if stamp.tzinfo is None: return None
            return time.time() - stamp.timestamp()
        except (ValueError, OverflowError, OSError):
            return None
    rss = 0
    if group:
        for p in Path('/proc').glob('[0-9]*/stat'):
            try:
                # comm may contain spaces/parentheses. Fields below start at state (3).
                fields = p.read_text().rsplit(')', 1)[1].split()
                if int(fields[2]) == group:
                    rss += int(fields[21]) * os.sysconf('SC_PAGE_SIZE') / 1048576
            except (FileNotFoundError, ProcessLookupError):
                continue
    return {'availableMiB': int(mem['MemAvailable'].split()[0])/1024,
            'memoryPsi': psi(Path('/proc/pressure/memory').read_text()),
            'ioPsi': psi(Path('/proc/pressure/io').read_text()),
            'heartbeatAge': age('heartbeatAt'), 'decisionAge': age('lastDecisionCompletedAt'),
            'decisionFailures': health.get('consecutiveDecisionFailures', 0), 'rssMiB': rss}


def pressure_reason(s, running=False):
    if s['availableMiB'] < (256 if running else 512): return 'host_memory_low'
    if s['memoryPsi'] >= 1: return 'host_memory_pressure'
    if s['ioPsi'] >= 10: return 'host_io_pressure'
    if s['heartbeatAge'] is None or not 0 <= s['heartbeatAge'] <= 15: return 'trading_heartbeat_stale'
    if s['decisionAge'] is None or not 0 <= s['decisionAge'] <= 60 or s['decisionFailures']: return 'trading_decision_unhealthy'
    if s['rssMiB'] >= 450: return 'research_memory_budget'
    return None


def mining_ready():
    # Opt-in only after a separately supervised installation + real fit smoke test.
    if os.environ.get('FACTOR_RESEARCH_SERVER_PYSR') != 'ready': return False
    exe = Path(os.environ.get('PYTHON_JULIAPKG_EXE', ''))
    project = Path(os.environ.get('PYTHON_JULIAPKG_PROJECT', ''))
    return exe.is_absolute() and exe.is_file() and project.is_absolute() and (project/'Manifest.toml').is_file()


def stop_group(child):
    # The inner worker owns its session; descendants inherit its process group.
    try: os.killpg(child.pid, signal.SIGKILL)
    except ProcessLookupError: pass
    child.wait(timeout=5)


def parent_alive(pid):
    # A transient service is parented by systemd, not by the requesting Node process.
    try:
        fields = Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()
        return fields[0] != 'Z' and fields[19] == os.environ.get('FACTOR_RESEARCH_PARENT_START', '')
    except (OSError, IndexError):
        return False


def verify_cgroup():
    unit = os.environ.get('FACTOR_RESEARCH_SYSTEMD_UNIT', '')
    expected = 'event-signal-research-'+os.environ['FACTOR_RESEARCH_TASK_ID']+'.service'
    group = next(line[3:] for line in Path('/proc/self/cgroup').read_text().splitlines() if line.startswith('0::'))
    if unit != expected or not group.startswith(f'/user.slice/user-{os.getuid()}.slice/') or not group.endswith('/'+unit):
        raise ValueError('research_cgroup_identity')
    root = Path('/sys/fs/cgroup'+group)
    memory = int((root/'memory.max').read_text())
    swap = int((root/'memory.swap.max').read_text())
    quota, period = map(int, (root/'cpu.max').read_text().split())
    tasks = int((root/'pids.max').read_text())
    if not (0 < memory <= 384*1048576 and swap == 0 and 0 < quota <= period/2 and 0 < tasks <= 32):
        raise ValueError('research_cgroup_limits')
    return {'path': group, 'memoryMax': memory, 'swapMax': swap, 'cpuMax': [quota, period], 'tasksMax': tasks}


def supervise(root, action, parent_pid):
    root = Path(root)
    task_id = os.environ['FACTOR_RESEARCH_TASK_ID']
    result_path = root/'resource-result.json'
    pending = root/f'report-{task_id}.pending.json'
    child = None
    last = None
    started = time.monotonic()
    def deferred(reason):
        atomic(result_path, {'taskId': task_id, 'reason': reason, 'profile': 'server-low',
                            'retryAfter': time.time()+300, 'resources': last})
        return 75
    try:
        if not server_low() or not sys.platform.startswith('linux'):
            return deferred('server_profile_requires_linux')
        try: isolation = verify_cgroup()
        except (OSError, ValueError, KeyError, StopIteration): return deferred('research_cgroup_unverified')
        if not parent_alive(parent_pid): return deferred('research_parent_exited')
        last = snapshot(root.parent)
        reason = pressure_reason(last)
        if reason: return deferred(reason)
        if action == 'mine' and not mining_ready(): return deferred('julia_maintenance_required')
        env = {**os.environ, 'FACTOR_RESEARCH_SUPERVISED': '1', 'FACTOR_RESEARCH_REPORT_OUTPUT': str(pending),
               'PYTHON_JULIAPKG_OFFLINE': 'yes', 'JULIA_PKG_PRECOMPILE_AUTO': '0'}
        for key in ('OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'MKL_NUM_THREADS', 'NUMEXPR_NUM_THREADS',
                    'JULIA_NUM_THREADS', 'JULIA_NUM_PRECOMPILE_TASKS'):
            env[key] = '1'
        os.nice(15)
        args = [sys.executable, str(Path(__file__).with_name('engine.py')), '--root', str(root)]
        if action != 'update': args.append('--'+action)
        child = subprocess.Popen(args, env=env, start_new_session=True)
        limit = {'update': 300, 'evaluate': 300, 'mine': 300}[action]
        while child.poll() is None:
            if not parent_alive(parent_pid): return deferred('research_parent_exited')
            if time.monotonic()-started >= limit: return deferred('research_time_budget')
            last = snapshot(root.parent, child.pid)
            reason = pressure_reason(last, running=True)
            if reason: return deferred(reason)
            time.sleep(2)
        if child.returncode: return child.returncode if child.returncode > 0 else 1
        if not parent_alive(parent_pid): return deferred('research_parent_exited')
        last = snapshot(root.parent)
        reason = pressure_reason(last, running=True)
        if reason: return deferred(reason)
        if not pending.is_file(): raise RuntimeError('research_report_missing')
        candidate = json.loads(pending.read_text(encoding='utf-8'))
        if action == 'mine' and candidate.get('mining', {}).get('status') == 'error':
            print('research_mining_failed: '+str(candidate['mining'].get('reason')), file=sys.stderr)
            return 1
        candidate.setdefault('resourcePolicy', {})['isolation'] = isolation
        atomic(pending, candidate)
        # Only a successful, healthy run replaces the prior report/publication.
        os.replace(pending, root/'report.json')
        return 0
    except (OSError, ValueError, KeyError, StopIteration) as error:
        # No metrics is not zero pressure; fail closed before loading numerical libraries.
        return deferred('resource_probe_unavailable:'+type(error).__name__)
    finally:
        if child: stop_group(child)
        pending.unlink(missing_ok=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', required=True)
    parser.add_argument('--action', choices=['update', 'evaluate', 'mine'], required=True)
    parser.add_argument('--parent', type=int, required=True)
    args = parser.parse_args()
    # SIGTERM must run finally and kill the whole numerical worker tree.
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
    sys.exit(supervise(args.root, args.action, args.parent))
