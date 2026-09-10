"""No numerical imports or real workload required for supervisor failure injection."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch, Mock
import resource_budget as rb


class ResourceTests(unittest.TestCase):
    def healthy(self):
        return dict(availableMiB=900, memoryPsi=0, ioPsi=.1,
                    heartbeatAge=2, decisionAge=8, decisionFailures=0, rssMiB=100)

    def test_local_unrestricted_and_explicit_server(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertFalse(rb.server_low())
            self.assertEqual(rb.budget()['panelDays'], 730)
            self.assertIsNone(rb.budget()['panelRows'])
        with patch.dict(os.environ, {'FACTOR_RESEARCH_PROFILE': 'server-low'}):
            self.assertTrue(rb.server_low())
            self.assertEqual(rb.budget()['panelRows'], 12000)

    def test_pressure_thresholds_fail_closed(self):
        self.assertIsNone(rb.pressure_reason(self.healthy()))
        for key, value, reason in [('availableMiB', 500, 'host_memory_low'),
                ('memoryPsi', 1, 'host_memory_pressure'), ('ioPsi', 10, 'host_io_pressure'),
                ('heartbeatAge', 16, 'trading_heartbeat_stale'),
                ('decisionAge', 61, 'trading_decision_unhealthy'),
                ('decisionFailures', 1, 'trading_decision_unhealthy'),
                ('rssMiB', 450, 'research_memory_budget')]:
            self.assertEqual(rb.pressure_reason({**self.healthy(), key: value}), reason)
        self.assertIsNone(rb.pressure_reason({**self.healthy(), 'availableMiB': 400}, True))
        self.assertEqual(rb.pressure_reason({**self.healthy(), 'availableMiB': 250}, True), 'host_memory_low')
        self.assertEqual(rb.psi('some avg10=0.15 avg60=0.21 total=42\nfull avg10=0.14'), .15)

    def test_mining_never_installs_when_unprepared(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertFalse(rb.mining_ready())
        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ, {
                'FACTOR_RESEARCH_SERVER_PYSR': 'ready', 'PYTHON_JULIAPKG_EXE': tmp+'/missing',
                'PYTHON_JULIAPKG_PROJECT': tmp}):
            self.assertFalse(rb.mining_ready())

    def test_startup_health_defers_without_starting_worker(self):
        now = '2026-09-10T00:00:00+00:00'
        health = {'heartbeatAt': now, 'lastDecisionCompletedAt': None,
                  'consecutiveDecisionFailures': 0}
        read = Path.read_text
        def read_fixture(p, *args, **kwargs):
            if p.name == 'meminfo': return 'MemAvailable: 921600 kB\n'
            if p.name in ('memory', 'io'): return 'some avg10=0.00 total=0\n'
            if p.name == 'service-status.json': return json.dumps(health)
            return read(p, *args, **kwargs)
        with tempfile.TemporaryDirectory() as tmp, \
                patch.object(Path, 'read_text', read_fixture), \
                patch.object(rb.time, 'time', return_value=rb.datetime.fromisoformat(now).timestamp()), \
                patch.dict(os.environ, {'FACTOR_RESEARCH_PROFILE':'server-low', 'FACTOR_RESEARCH_TASK_ID':'startup'}), \
                patch.object(rb.sys, 'platform', 'linux'), \
                patch.object(rb, 'verify_cgroup', return_value={'verified':True}), \
                patch.object(rb, 'parent_alive', return_value=True), \
                patch.object(rb.subprocess, 'Popen') as start:
            root = Path(tmp)/'research'; root.mkdir()
            report = root/'report.json'; report.write_text('{"old":true}')
            for key, metric, reason in [('lastDecisionCompletedAt', 'decisionAge', 'trading_decision_unhealthy'),
                                        ('heartbeatAt', 'heartbeatAge', 'trading_heartbeat_stale')]:
                health.update(heartbeatAt=now, lastDecisionCompletedAt=now)
                for value in [None, '', 123, {}, 'invalid', '2026-09-10T00:00:00', 'missing']:
                    with self.subTest(key=key, value=value):
                        if value == 'missing': health.pop(key, None)
                        else: health[key] = value
                        sample = rb.snapshot(root.parent)
                        self.assertIsNone(sample[metric])
                        self.assertEqual(rb.pressure_reason(sample), reason)
                        self.assertEqual(rb.supervise(root, 'update', 123), 75)
                        result = json.loads((root/'resource-result.json').read_text())
                        self.assertEqual(result['reason'], reason)
                        self.assertIsNone(result['resources'][metric])
                        self.assertEqual(json.loads(report.read_text()), {'old':True})
                health[key] = '2026-09-10T00:00:01+00:00'
                self.assertEqual(rb.pressure_reason(rb.snapshot(root.parent)), reason)
            start.assert_not_called()
            health.update(heartbeatAt=now, lastDecisionCompletedAt=now)
            self.assertIsNone(rb.pressure_reason(rb.snapshot(root.parent)))

    def test_supervisor_preserves_report_and_cleans_tree(self):
        for scenario in ['isolation', 'parent', 'parent_running', 'parent_completed', 'preflight', 'probe_error', 'mine', 'running', 'failed', 'success']:
            with self.subTest(scenario=scenario), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp); report = root/'report.json'
                report.write_text('{"old":true}')
                child = Mock(pid=4321, returncode=1 if scenario=='failed' else 0)
                child.poll.return_value = None if scenario in ['running', 'parent_running'] else child.returncode
                def spawn(*args, **kwargs):
                    self.assertEqual(kwargs['env']['OMP_NUM_THREADS'], '1')
                    self.assertEqual(kwargs['env']['PYTHON_JULIAPKG_OFFLINE'], 'yes')
                    self.assertTrue(kwargs['start_new_session'])
                    (root/'report-fixture.pending.json').write_text('{"new":true}')
                    return child
                sample = self.healthy()
                if scenario=='preflight': sample['availableMiB'] = 100
                samples = [sample, {**sample, 'availableMiB': 100}] if scenario=='running' else None
                with patch.dict(os.environ, {'FACTOR_RESEARCH_PROFILE':'server-low', 'FACTOR_RESEARCH_TASK_ID':'fixture'}), \
                        patch.object(rb.sys, 'platform', 'linux'), \
                        patch.object(rb.os, 'nice', create=True), \
                        patch.object(rb, 'verify_cgroup', side_effect=ValueError('uncapped') if scenario=='isolation' else None, return_value={'verified':True}), \
                        patch.object(rb, 'parent_alive', side_effect=[True, False] if scenario in ['parent_running','parent_completed'] else None, return_value=scenario!='parent'), \
                        patch.object(rb, 'mining_ready', return_value=False), \
                        patch.object(rb, 'snapshot', side_effect=OSError('missing') if scenario=='probe_error' else samples, return_value=sample), \
                        patch.object(rb.subprocess, 'Popen', side_effect=spawn) as start, \
                        patch.object(rb, 'stop_group') as stop:
                    code=rb.supervise(root, 'mine' if scenario=='mine' else 'evaluate', 123)
                self.assertEqual(code, 0 if scenario=='success' else 1 if scenario=='failed' else 75)
                self.assertEqual(json.loads(report.read_text()), {'new':True, 'resourcePolicy':{'isolation':{'verified':True}}} if code==0 else {'old':True})
                self.assertFalse((root/'report-fixture.pending.json').exists())
                self.assertEqual(start.call_count, int(scenario in ['running','failed','success','parent_running','parent_completed']))
                self.assertEqual(stop.call_count, start.call_count)
                if code==75:
                    self.assertEqual(json.loads((root/'resource-result.json').read_text())['taskId'], 'fixture')

    def test_owner_identity_not_systemd_parent(self):
        # State is field 3, start time field 22. comm itself may contain parentheses.
        fields = ['S'] + ['0']*18 + ['123456']
        with patch.dict(os.environ, {'FACTOR_RESEARCH_PARENT_START':'123456'}), \
                patch.object(Path, 'read_text', return_value='123 (node (worker)) '+' '.join(fields)):
            self.assertTrue(rb.parent_alive(123))
            with patch.dict(os.environ, {'FACTOR_RESEARCH_PARENT_START':'654321'}):
                self.assertFalse(rb.parent_alive(123))
        fields[0] = 'Z'
        with patch.object(Path, 'read_text', return_value='123 (node) '+' '.join(fields)):
            self.assertFalse(rb.parent_alive(123))
        with patch.object(Path, 'read_text', side_effect=FileNotFoundError()):
            self.assertFalse(rb.parent_alive(123))

    def test_kernel_limits_required_before_import(self):
        unit='event-signal-research-fixture.service'
        files={'cgroup': f'0::/user.slice/user-1000.slice/user@1000.service/app.slice/{unit}\n',
               'memory.max':'402653184', 'memory.swap.max':'0', 'cpu.max':'50000 100000', 'pids.max':'32'}
        with patch.dict(os.environ, {'FACTOR_RESEARCH_TASK_ID':'fixture','FACTOR_RESEARCH_SYSTEMD_UNIT':unit}), \
                patch.object(rb.os, 'getuid', return_value=1000, create=True), \
                patch.object(Path, 'read_text', autospec=True, side_effect=lambda p: files[p.name]):
            self.assertEqual(rb.verify_cgroup()['memoryMax'], 402653184)
            for key, value in [('cgroup','0::/system.slice/monitor.service'), ('memory.max','max'),
                    ('memory.max','536870912'), ('memory.swap.max','1'), ('cpu.max','100000 100000'),
                    ('cpu.max','max 100000'), ('pids.max','64')]:
                old=files[key]; files[key]=value
                with self.subTest(key=key,value=value), self.assertRaises(ValueError): rb.verify_cgroup()
                files[key]=old

    @unittest.skipUnless(sys.platform.startswith('linux'), 'real process-group kill requires Linux')
    def test_real_linux_process_group(self):
        child=subprocess.Popen([sys.executable,'-c','import time; time.sleep(60)'], start_new_session=True)
        rb.stop_group(child)
        self.assertIsNotNone(child.returncode)


if __name__=='__main__': unittest.main(verbosity=2)
