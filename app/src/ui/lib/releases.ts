export const ReleaseNotesUri =
  __RELEASE_CHANNEL__ === 'custom'
    ? 'https://github.com/jim-jiang-github/desktop/releases'
    : __RELEASE_CHANNEL__ === 'beta'
    ? 'https://desktop.github.com/release-notes/?env=beta'
    : 'https://desktop.github.com/release-notes/'
