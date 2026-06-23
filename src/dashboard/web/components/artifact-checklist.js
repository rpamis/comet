// Artifact checklist for the selected change.

import { escape } from '../utils.js';
import { ARTIFACT_ROWS, STATE_GLYPH, STATE_TEXT } from './constants.js';

export function renderArtifactChecklist({ artifacts, containerId, statusId, labelTemplate }) {
  const items = ARTIFACT_ROWS.map(([name, key]) => [name, artifacts[key]]);
  const ready = items.filter(([, ok]) => ok).length;
  document.getElementById(statusId).textContent = labelTemplate(ready, items.length);
  document.getElementById(containerId).innerHTML = items.map(renderRow).join('');
}

function renderRow([name, ok]) {
  const stateName = ok ? 'done' : 'pending';
  const cls = ok ? 'status-ok' : 'status-muted';
  return `
    <div class="check-row">
      <span class="mono">${escape(name)}</span>
      <span class="pill ${cls}">${STATE_GLYPH[stateName]} ${STATE_TEXT[stateName]}</span>
    </div>
  `;
}
