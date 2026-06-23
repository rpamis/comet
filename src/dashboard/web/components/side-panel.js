// Side Panel: branches by selected change status (active vs archived).

import { renderArchiveSummaryCard } from './archive-summary-card.js';
import { renderArtifactChecklist } from './artifact-checklist.js';
import { renderFinalVerifyCard } from './final-verify-card.js';
import { renderGitSnapshot } from './git-snapshot.js';
import { renderNextActionCard } from './next-action-card.js';
import { renderRiskList } from './risk-list.js';

export function renderSidePanel({ change, git }) {
  if (change.status === 'archived') {
    renderArchivedSide(change);
  } else {
    renderActiveSide(change);
  }
  renderGitSnapshot({ git });
}

function renderActiveSide(change) {
  renderNextActionCard({ change });
  document.getElementById('rightSecondary').dataset.component = 'RiskList';
  document.getElementById('rightSecondaryTitle').textContent = '风险提示';
  document.getElementById('artifactSnapshotCard').hidden = true;
  renderRiskList({ risks: change.risks });
}

function renderArchivedSide(change) {
  renderArchiveSummaryCard({ change });
  renderFinalVerifyCard({ change });

  // Reveal the ArtifactSnapshotCard (hidden for active selections).
  document.getElementById('artifactSnapshotCard').hidden = false;
  renderArtifactChecklist({
    artifacts: change.artifacts,
    containerId: 'artifactSnapshot',
    statusId: 'snapshotStatus',
    labelTemplate: (ready, total) => `${ready} / ${total} 已归档`,
  });
}
