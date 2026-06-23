// Topbar: project name + path + optional phase pill for the selected change.

import { escape } from '../utils.js';
import { PHASE_LABELS } from './constants.js';

export function renderTopbar({ project, selected }) {
  document.getElementById('projectName').textContent = project.name || 'Comet Dashboard';
  document.getElementById('projectPath').textContent = project.path;

  const pill = document.getElementById('projectPhasePill');
  if (selected && selected.status === 'active') {
    const cmd = selected.next?.command;
    const phaseLabel = PHASE_LABELS[selected.phase] ?? '未知阶段';
    pill.hidden = false;
    pill.className = `pill ${selected.verify.result === 'fail' ? 'status-danger' : 'status-current'}`;
    pill.innerHTML = `<span class="dot"></span>${escape(phaseLabel)} 阶段${cmd ? ` · ${escape(cmd)}` : ''}`;
  } else {
    pill.hidden = true;
  }
}
