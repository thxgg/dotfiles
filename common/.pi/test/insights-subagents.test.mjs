import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

test('insights reads headless child metadata and excludes child sessions', () => {
  const script = fileURLToPath(new URL('../agent/skills/insights/scripts/extract_sessions.py', import.meta.url));
  const code = `
import importlib.util, json, pathlib, tempfile
spec = importlib.util.spec_from_file_location('insights', ${JSON.stringify(script)})
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
with tempfile.TemporaryDirectory() as tmp:
    root = pathlib.Path(tmp)
    run = root / 'aabbcc'
    run.mkdir()
    session = run / 'session.jsonl'
    session.write_text(json.dumps({'type': 'session', 'id': 'child', 'cwd': tmp}) + '\\n' + json.dumps({'type': 'message', 'message': {'role': 'assistant', 'content': [{'type': 'text', 'text': 'done'}]}}) + '\\n')
    (run / 'metadata.json').write_text(json.dumps({'handle': 'aabbcc', 'name': 'investigation', 'sessionFile': str(session), 'cwd': tmp, 'state': 'idle', 'parentSessionId': 'parent', 'prompt': 'inspect'}))
    assert str(session.resolve()) in m.child_session_files(root)
    rows = list(m.subagent_sessions(root, tmp))
    assert len(rows) == 1
    assert rows[0]['summary'] == 'done'
    assert rows[0]['parent_session'] == 'parent'
    assert list(m.primary_sessions(root, tmp, m.child_session_files(root), set())) == []
`;
  const result = spawnSync('python3', ['-c', code], { env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
