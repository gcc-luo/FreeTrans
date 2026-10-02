import { observer } from 'mobx-react';
import { Component, type ReactElement } from 'react';
import {
  type WrappedComponentProps,
  defineMessages,
  injectIntl,
} from 'react-intl';
import injectSheet, { type WithStylesProps } from 'react-jss';
import type { Theme } from '../../../themes';

const messages = defineMessages({
  loading: {
    id: 'service.webviewLoader.loading',
    defaultMessage: 'Loading {service}',
  },
  hint: {
    id: 'service.webviewLoader.hint',
    defaultMessage: 'The first load may take a little longer.',
  },
});

const styles = (theme: Theme) => ({
  wrapper: {
    alignItems: 'center',
    display: 'flex',
    height: '100%',
    inset: 0,
    justifyContent: 'center',
    position: 'absolute' as const,
    width: '100%',
    zIndex: 10,
  },
  content: {
    alignItems: 'center',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 9,
    padding: 20,
    textAlign: 'center' as const,
  },
  spinner: {
    animation: '$spin 0.9s linear infinite',
    border: `3px solid ${theme.toggleBackground}`,
    borderRadius: '50%',
    borderRightColor: theme.brandPrimary,
    borderTopColor: theme.brandPrimary,
    height: 32,
    marginBottom: 2,
    width: 32,
    '@media (prefers-reduced-motion: reduce)': {
      animation: 'none',
    },
  },
  '@keyframes spin': {
    to: { transform: 'rotate(360deg)' },
  },
  title: {
    color: theme.colorHeadline,
    fontSize: 16,
    fontWeight: 600,
    lineHeight: 1.4,
  },
  hint: {
    color: theme.colorText,
    fontSize: 13,
    lineHeight: 1.4,
    opacity: 0.68,
  },
});

interface IProps extends WithStylesProps<typeof styles>, WrappedComponentProps {
  name: string;
  loaded?: boolean;
}

class WebviewLoader extends Component<IProps> {
  render(): ReactElement {
    const { classes, name, loaded = false, intl } = this.props;
    return (
      <div className={classes.wrapper} role="status" aria-live="polite">
        <div className={classes.content}>
          {!loaded && <span className={classes.spinner} aria-hidden="true" />}
          <div className={classes.title}>
            {intl.formatMessage(messages.loading, { service: name })}
          </div>
          <div className={classes.hint}>
            {intl.formatMessage(messages.hint)}
          </div>
        </div>
      </div>
    );
  }
}

export default injectIntl(
  injectSheet(styles, { injectTheme: true })(observer(WebviewLoader)),
);
