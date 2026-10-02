import { observer } from 'mobx-react';
import { Component } from 'react';
import { type IntlShape, defineMessages, injectIntl } from 'react-intl';
import { ferdiumVersion } from '../../../environment-remote';
import {
  getAppVersionTag,
  getUpdateInfoFromGitHub,
  type GitHubReleaseInfo,
} from '../../../helpers/update-helpers';

const messages = defineMessages({
  headline: {
    id: 'settings.releasenotes.headline',
    defaultMessage: 'Release Notes',
  },
  connectionError: {
    id: 'settings.releasenotes.connectionError',
    defaultMessage:
      'An error occurred when connecting to GitHub, please try again later.',
  },
  connectionErrorPageMissing: {
    id: 'settings.releasenotes.connectionErrorPageMissing',
    defaultMessage:
      'An error occurred when connecting to GitHub, the release you are looking for is missing.',
  },
  noCommitDetails: {
    id: 'settings.releasenotes.noCommitDetails',
    defaultMessage: 'No commit details are available for this release.',
  },
  loading: {
    id: 'settings.releasenotes.loading',
    defaultMessage: 'Loading release notes…',
  },
  groupImprovements: {
    id: 'settings.releasenotes.groupImprovements',
    defaultMessage: 'New and improved',
  },
  groupFixes: {
    id: 'settings.releasenotes.groupFixes',
    defaultMessage: 'Fixes',
  },
  groupDocsAndRelease: {
    id: 'settings.releasenotes.groupDocsAndRelease',
    defaultMessage: 'Documentation and release',
  },
  groupOther: {
    id: 'settings.releasenotes.groupOther',
    defaultMessage: 'Other changes',
  },
  commitCount: {
    id: 'settings.releasenotes.commitCount',
    defaultMessage: '{count} commits',
  },
});

const getCommitGroup = (subject: string) => {
  const type = subject.match(/^([a-z]+)(?:\([^)]*\))?:/i)?.[1]?.toLowerCase();

  if (type === 'feat' || type === 'perf' || type === 'refactor') {
    return 'improvements';
  }

  if (type === 'fix') {
    return 'fixes';
  }

  if (['docs', 'build', 'ci', 'chore', 'test'].includes(type ?? '')) {
    return 'docsAndRelease';
  }

  return 'other';
};

const getGroupLabel = (
  intl: IntlShape,
  group: { key: string; label: (typeof messages)[keyof typeof messages] },
) => {
  if (intl.locale.toLowerCase().startsWith('zh')) {
    const chineseLabels: Record<string, string> = {
      improvements: '新增与改进',
      fixes: '问题修复',
      docsAndRelease: '文档与发布',
      other: '其他更新',
    };

    return chineseLabels[group.key] ?? intl.formatMessage(group.label);
  }

  return intl.formatMessage(group.label);
};

interface IProps {
  intl: IntlShape;
}

interface IState {
  data: GitHubReleaseInfo | null;
  isLoading: boolean;
}

class ReleaseNotesDashboard extends Component<IProps, IState> {
  constructor(props) {
    super(props);

    this.state = { data: null, isLoading: true };
  }

  async componentDidMount() {
    const { intl } = this.props;

    try {
      const data = await getUpdateInfoFromGitHub(
        window.location.href,
        ferdiumVersion,
        intl,
      );

      this.setState({ data, isLoading: false });
    } catch {
      // The helper normally returns a localized error result; keep the loading
      // state finite if the IPC request fails before reaching that handler.
      this.setState({
        data: {
          version: getAppVersionTag(window.location.href, ferdiumVersion),
          date: null,
          previousVersion: null,
          commits: [],
          error: intl.formatMessage(messages.connectionError),
        },
        isLoading: false,
      });
    }
  }

  render() {
    const { intl } = this.props;

    const { data } = this.state;
    const commits = data?.commits.map(commit => ({
      ...commit,
      subject: commit.message.split(/\r?\n/, 1)[0].trim(),
    }));
    const commitGroups = commits
      ? [
          {
            key: 'improvements',
            label: messages.groupImprovements,
          },
          { key: 'fixes', label: messages.groupFixes },
          {
            key: 'docsAndRelease',
            label: messages.groupDocsAndRelease,
          },
          { key: 'other', label: messages.groupOther },
        ]
          .map(group => ({
            ...group,
            commits: commits.filter(
              commit => getCommitGroup(commit.subject) === group.key,
            ),
          }))
          .filter(group => group.commits.length > 0)
      : [];

    return (
      <div className="settings__main">
        <div className="settings__header">
          <span className="settings__header-item">
            FreeTrans{' '}
            {data?.version ??
              getAppVersionTag(window.location.href, ferdiumVersion)}{' '}
            {' | '}
          </span>
          <span className="settings__header-item__secondary">
            {intl.formatMessage(messages.headline)}
          </span>
          {data?.date && (
            <span className="settings__header-item__secondary">
              {new Date(data.date).toLocaleDateString(intl.locale)}
            </span>
          )}
        </div>
        <div className="settings__body releasenotes__body">
          {this.state.isLoading ? (
            <div
              className="release-notes__loading"
              role="status"
              aria-live="polite"
            >
              <span
                className="release-notes__loading-spinner"
                aria-hidden="true"
              />
              <span>{intl.formatMessage(messages.loading)}</span>
            </div>
          ) : data ? (
            <section className="release-notes">
              {data.error ? (
                <p className="release-notes__message">{data.error}</p>
              ) : data.commits.length > 0 ? (
                <>
                  <div className="release-notes__range">
                    {data.previousVersion && (
                      <span>
                        {data.previousVersion} → {data.version}
                      </span>
                    )}
                    <span>
                      {intl.formatMessage(messages.commitCount, {
                        count: data.commits.length,
                      })}
                    </span>
                  </div>
                  {commitGroups.map(group => (
                    <section className="release-notes__group" key={group.key}>
                      <h2 className="release-notes__group-title">
                        {getGroupLabel(intl, group)}
                      </h2>
                      <ul className="release-notes__commits">
                        {group.commits.map(commit => (
                          <li key={commit.sha}>{commit.subject}</li>
                        ))}
                      </ul>
                    </section>
                  ))}
                </>
              ) : (
                <p className="release-notes__message">
                  {intl.formatMessage(messages.noCommitDetails)}
                </p>
              )}
            </section>
          ) : null}
        </div>
      </div>
    );
  }
}

export default injectIntl(observer(ReleaseNotesDashboard));
