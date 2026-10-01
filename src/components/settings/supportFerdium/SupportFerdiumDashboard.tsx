import { defineMessages, useIntl } from 'react-intl';

const messages = defineMessages({
  headline: {
    id: 'settings.supportFerdium.headline',
    defaultMessage: 'About FreeTrans',
  },
  descriptionHeading: {
    id: 'settings.supportFerdium.descriptionHeading',
    defaultMessage: 'Product description',
  },
  aboutSummary: {
    id: 'settings.supportFerdium.aboutSummary',
    defaultMessage:
      'FreeTrans is a desktop translation app for messaging services. Built on Ferdium’s multi-service desktop experience, it helps you understand incoming messages in other languages and translate your own before sending.',
  },
  translationFeatures: {
    id: 'settings.supportFerdium.translationFeatures',
    defaultMessage: 'Translation features',
  },
  receiveTranslation: {
    id: 'settings.supportFerdium.receiveTranslation',
    defaultMessage:
      'Incoming message translation: set a target language for supported services and view translated messages.',
  },
  sendTranslation: {
    id: 'settings.supportFerdium.sendTranslation',
    defaultMessage:
      'Translate before sending: automatically translate your message into the recipient’s language before sending it.',
  },
  serviceConfiguration: {
    id: 'settings.supportFerdium.serviceConfiguration',
    defaultMessage:
      'Per-service settings: choose a translation engine and target language, and control incoming and outgoing translation separately.',
  },
  translationEngines: {
    id: 'settings.supportFerdium.translationEngines',
    defaultMessage:
      'Translation engines: Google, Baidu, LibreTranslate, and MyMemory. Availability depends on the selected provider’s network service and account configuration.',
  },
});

const SupportFerdiumDashboard = () => {
  const intl = useIntl();

  return (
    <div className="settings__main">
      <div className="settings__header">
        <span className="settings__header-item">
          {intl.formatMessage(messages.headline)}
        </span>
      </div>
      <div className="settings__body settings__about">
        <h3>{intl.formatMessage(messages.descriptionHeading)}</h3>
        <p>{intl.formatMessage(messages.aboutSummary)}</p>
        <h3>{intl.formatMessage(messages.translationFeatures)}</h3>
        <ul>
          <li>{intl.formatMessage(messages.receiveTranslation)}</li>
          <li>{intl.formatMessage(messages.sendTranslation)}</li>
          <li>{intl.formatMessage(messages.serviceConfiguration)}</li>
          <li>{intl.formatMessage(messages.translationEngines)}</li>
        </ul>
      </div>
    </div>
  );
};

export default SupportFerdiumDashboard;
