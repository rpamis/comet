// Git snapshot card (always visible).

import { escape } from '../utils.js';

export function renderGitSnapshot({ git }) {
  // Defend against partial snapshots: a stale or malformed /api/dashboard
  // response should still render an empty card instead of throwing.
  const recentCommits = Array.isArray(git?.recentCommits) ? git.recentCommits : [];
  const dirtyFileList = Array.isArray(git?.dirtyFileList) ? git.dirtyFileList : [];
  const dirtyFiles = Number.isFinite(git?.dirtyFiles) ? git.dirtyFiles : dirtyFileList.length;
  const branch = git?.branch ?? null;
  const head = git?.head ?? null;

  const badge = document.getElementById('dirtyBadge');
  badge.textContent = `${dirtyFiles} 个未提交`;
  badge.className = `pill ${dirtyFiles > 0 ? 'status-warn' : 'status-ok'}`;

  document.getElementById('gitSnapshot').innerHTML = `
    <div class="git-row"><span>分支</span><strong class="mono">${escape(branch ?? '—')}</strong></div>
    <div class="git-row"><span>HEAD</span><strong class="mono">${escape(head ?? '—')}</strong></div>
    <div class="git-row"><span>未提交</span><strong class="mono">${dirtyFiles} 个文件</strong></div>
  `;

  document.getElementById('commitList').innerHTML = recentCommits.length
    ? recentCommits.map((c) => `<li class="mono">${escape(c)}</li>`).join('')
    : '<li class="muted">无提交记录</li>';

  document.getElementById('dirtyList').innerHTML = dirtyFileList.length
    ? dirtyFileList
        .map((f) => `<li class="mono"><span class="flag">M</span>${escape(f)}</li>`)
        .join('')
    : '<li class="muted">工作区干净</li>';
}
