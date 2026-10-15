import type { ReactElement } from 'react';
import {
  type WrappedComponentProps,
  defineMessages,
  injectIntl,
} from 'react-intl';
import withStyles, { type WithStylesProps } from 'react-jss';
import type { Theme } from '../../../themes';

import styles from './styles';

const messages = defineMessages({
  connectingTitle: {
    id: 'loading.connectingConversations',
    defaultMessage: 'Connecting your conversations',
  },
  connectingDescription: {
    id: 'loading.translationAlmostReady',
    defaultMessage: 'Cross-language conversations will be ready in a moment.',
  },
});

interface IProps extends WithStylesProps<typeof styles>, WrappedComponentProps {
  theme: Theme;
  texts?: string[];
}

const AppLoader = ({ classes, intl, theme, texts }: IProps): ReactElement => {
  const title = texts?.[0] ?? intl.formatMessage(messages.connectingTitle);

  return (
    <main className={classes.shell} aria-busy="true">
      <div className={classes.ambientGlow} aria-hidden="true" />
      <section className={classes.content}>
        {!texts && (
          <div className={classes.conversation} aria-hidden="true">
            <span className={classes.incomingBubble}>Hello</span>
            <span
              className={classes.exchangeIcon}
              style={{ color: theme.brandPrimary }}
            >
              ⇄
            </span>
            <span className={classes.outgoingBubble}>你好</span>
          </div>
        )}

        <h1 className={classes.title} role="status" aria-live="polite">
          {title}
        </h1>
        {!texts && (
          <p className={classes.description}>
            {intl.formatMessage(messages.connectingDescription)}
          </p>
        )}

        <div className={classes.loadingDots} aria-hidden="true">
          <span className={classes.dot} />
          <span className={classes.dot} />
          <span className={classes.dot} />
        </div>

        <div className={classes.brand} aria-hidden="true">
          <span className={classes.brandMark}>F</span>
          <span>FreeTrans</span>
        </div>
      </section>
    </main>
  );
};

export default injectIntl(withStyles(styles, { injectTheme: true })(AppLoader));
