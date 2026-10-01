import { join } from 'node:path';
import { ipcRenderer } from 'electron';
import { action, makeObservable, observable, reaction } from 'mobx';
import { observer } from 'mobx-react';
import { Component, type ReactElement } from 'react';
import ElectronWebView from 'react-electron-web-view';
import type ServiceModel from '../../../models/Service';
import type { RealStores } from '../../../stores';

const debug = require('../../../preload-safe-debug')('Ferdium:Services');

const RESPONSIVE_ZOOM_REFERENCE_WIDTH = 720;
const RESPONSIVE_ZOOM_MIN_FACTOR = 0.55;

interface IProps {
  service: ServiceModel;
  setWebviewReference: (options: {
    serviceId: string;
    webview: ElectronWebView | null;
  }) => void;
  detachService: (options: { service: ServiceModel }) => void;
  isSpellcheckerEnabled: boolean;
  stores?: RealStores;
}

@observer
class ServiceWebview extends Component<IProps> {
  @observable webview: ElectronWebView | null = null;

  private resizeObserver: ResizeObserver | undefined;

  private observedContainer: Element | undefined;

  private baseZoomFactor: number | undefined;

  private lastResponsiveZoomFactor: number | undefined;

  private lastResponsiveScale = 1;

  constructor(props: IProps) {
    super(props);

    this.refocusWebview = this.refocusWebview.bind(this);
    this._setWebview = this._setWebview.bind(this);

    makeObservable(this);

    reaction(
      () => this.webview,
      () => {
        if (this.webview?.view) {
          this.webview.view.addEventListener('console-message', e => {
            const message = e.message || '';
            // 如果是翻译相关的日志，直接输出到控制台
            if (message.includes('[Ferdium Translator]')) {
              // eslint-disable-next-line no-console
              console.log('[WebView Console]', message);
              ipcRenderer.send('app:log-to-file', {
                level: e.level >= 2 ? 'warn' : 'info',
                scope: `webview:${this.props.service.id}`,
                message,
              });
            }
            debug('Service logged a message:', message);
          });
          this.webview.view.addEventListener('did-navigate', () => {
            if (this.props.service._webview) {
              document.title = `FreeTrans - ${this.props.service.name} ${
                this.props.service.dialogTitle
                  ? ` - ${this.props.service.dialogTitle}`
                  : ''
              } ${`- ${this.props.service._webview.getTitle()}`}`;
            }
          });
        }
      },
    );
  }

  componentWillUnmount(): void {
    this.resizeObserver?.disconnect();
    const { service, detachService } = this.props;
    detachService({ service });
  }

  private observeResponsiveWidth = (): void => {
    const webview = this.webview;
    if (!webview?.isReady()) return;

    const container = (webview.view as any).closest(
      '.services__webview',
    ) as Element | null;
    if (!container) return;

    if (!this.resizeObserver) {
      this.resizeObserver = new ResizeObserver(this.updateResponsiveZoom);
    }

    if (container !== this.observedContainer) {
      this.resizeObserver.disconnect();
      this.observedContainer = container;
      this.resizeObserver.observe(container);
    }

    this.updateResponsiveZoom();
  };

  private updateResponsiveZoom = (): void => {
    const webview = this.webview;
    const container = this.observedContainer as HTMLElement | undefined;
    if (!webview?.isReady() || !container) return;

    const currentZoomFactor = (webview.view as any).getZoomFactor?.() ?? 1;
    if (
      this.lastResponsiveZoomFactor !== undefined &&
      Math.abs(currentZoomFactor - this.lastResponsiveZoomFactor) > 0.01
    ) {
      // Preserve manual zoom changes when the responsive scale is recalculated.
      this.baseZoomFactor = currentZoomFactor / this.lastResponsiveScale;
    } else if (this.baseZoomFactor === undefined) {
      this.baseZoomFactor = currentZoomFactor;
    }

    const translatorPanelOpen = Boolean(
      document.querySelector('.translator-panel.is-open'),
    );
    const width = container.getBoundingClientRect().width;
    const responsiveScale = translatorPanelOpen
      ? Math.max(
          RESPONSIVE_ZOOM_MIN_FACTOR,
          Math.min(1, width / RESPONSIVE_ZOOM_REFERENCE_WIDTH),
        )
      : 1;
    const targetZoomFactor = this.baseZoomFactor * responsiveScale;

    if (Math.abs(currentZoomFactor - targetZoomFactor) > 0.01) {
      webview.setZoomFactor(targetZoomFactor);
    }

    this.lastResponsiveScale = responsiveScale;
    this.lastResponsiveZoomFactor = targetZoomFactor;
  };

  refocusWebview(): void {
    const { webview } = this;
    debug('Refocus Webview is called', this.props.service);
    if (!webview) {
      return;
    }

    if (this.props.service.isActive) {
      webview.view.blur();
      webview.view.focus();
      window.setTimeout(() => {
        document.title = `FreeTrans - ${this.props.service.name} ${
          this.props.service.dialogTitle
            ? ` - ${this.props.service.dialogTitle}`
            : ''
        } ${`- ${this.props.service._webview.getTitle()}`}`;
      }, 100);
    } else {
      debug('Refocus not required - Not active service');
    }
  }

  @action _setWebview(webview): void {
    if (this.webview !== webview) {
      this.resizeObserver?.disconnect();
      this.observedContainer = undefined;
      this.baseZoomFactor = undefined;
      this.lastResponsiveZoomFactor = undefined;
      this.lastResponsiveScale = 1;
    }
    this.webview = webview;
  }

  render(): ReactElement {
    const { service, setWebviewReference, isSpellcheckerEnabled, stores } =
      this.props;

    const { sandboxServices } = stores!.settings.app;

    const { sandboxServices: sandboxes } = stores!.app;

    const checkForSandbox = () => {
      const sandbox = sandboxes.find(s => s.services.includes(service.id));

      if (sandbox) {
        return `persist:sandbox-${sandbox.id}`;
      }

      return service.partition;
    };

    const preloadScript = join(
      __dirname,
      '..',
      '..',
      '..',
      'webview',
      'recipe.js',
    );

    return (
      <ElectronWebView
        ref={webview => {
          this._setWebview(webview);
          if (webview?.view) {
            webview.view.addEventListener(
              'did-stop-loading',
              this.refocusWebview,
            );
          }
        }}
        autosize
        src={service.url}
        preload={preloadScript}
        partition={
          sandboxServices ? checkForSandbox() : 'persist:general-session'
        }
        onDidAttach={() => {
          // Force the event handler to run in a new task.
          // This resolves a race condition when the `did-attach` is called,
          // but the webview is not attached to the DOM yet:
          // https://github.com/electron/electron/issues/31918
          // This prevents us from immediately attaching listeners such as `did-stop-load`:
          // https://github.com/ferdium/ferdium-app/issues/157
          setTimeout(() => {
            this.observeResponsiveWidth();
            setWebviewReference({
              serviceId: service.id,
              webview: this.webview.view,
            });
          }, 0);
        }}
        // onUpdateTargetUrl={this.updateTargetUrl} // TODO: [TS DEBT] need to check where its from
        useragent={service.userAgent}
        disablewebsecurity={
          service.recipe.disablewebsecurity ? true : undefined
        }
        allowpopups
        nodeintegration
        webpreferences={`spellcheck=${
          isSpellcheckerEnabled ? 1 : 0
        }, contextIsolation=1`}
      />
    );
  }
}

export default ServiceWebview;
