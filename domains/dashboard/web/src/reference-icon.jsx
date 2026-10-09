import React from 'react';
import artifact from './reference-icons/artifact.svg?url';
import book from './reference-icons/book.svg?url';
import branch from './reference-icons/branch.svg?url';
import chevron from './reference-icons/chevron.svg?url';
import copy from './reference-icons/copy.svg?url';
import file from './reference-icons/file.svg?url';
import git from './reference-icons/git.svg?url';
import native from './reference-icons/native.svg?url';
import refresh from './reference-icons/refresh.svg?url';
import search from './reference-icons/search.svg?url';
import settings from './reference-icons/settings.svg?url';
import sun from './reference-icons/sun.svg?url';

const icons = {
  artifact,
  book,
  branch,
  chevron,
  copy,
  file,
  git,
  native,
  refresh,
  search,
  settings,
  sun,
};

export function ReferenceIcon({ name }) {
  return <img className="comet-reference-icon" src={icons[name]} alt="" aria-hidden="true" />;
}
