// Final Verify card — replaces RiskList for archived changes.

import { escape } from '../utils.js';
import { VERIFY_CLASS, VERIFY_LABEL } from './constants.js';

export function renderFinalVerifyCard({ change }) {
  const secondary = document.getElementById('rightSecondary');
  secondary.dataset.component = 'FinalVerifyCard';
  document.getElementById('rightSecondaryTitle').textContent = '最终验证';

  const verifyCls = VERIFY_CLASS[change.verify.result] ?? 'status-muted';
  const pill = document.getElementById('riskCount');
  pill.className = `pill ${verifyCls}`;
  pill.textContent = VERIFY_LABEL[change.verify.result] ?? change.verify.result;

  document.getElementById('riskList').innerHTML = `
    <div class="git-row">
      <span>verify</span>
      <strong class="mono ${verifyCls}">${escape(change.verify.result)}</strong>
    </div>
    <div class="git-row">
      <span>report</span>
      <strong class="mono">${change.verify.reportExists ? 'available' : 'missing'}</strong>
    </div>
    <div class="git-row">
      <span>summary</span>
      <strong>${escape(change.verify.summary ?? '—')}</strong>
    </div>
  `;
}
