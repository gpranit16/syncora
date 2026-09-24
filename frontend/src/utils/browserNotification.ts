// ============================================================================
// Syncora Browser Desktop Notification & Tab Title Badge Manager
// ============================================================================

export interface BrowserNotificationOptions {
  title: string;
  body: string;
  icon?: string;
  tag?: string;
  onClick?: () => void;
}

class BrowserNotificationManager {
  private defaultTitle: string = 'Syncora — Real-Time Team Collaboration & AI Workspace';
  private flashingInterval: number | null = null;
  private isTabActive: boolean = true;
  private pendingUnreadCount: number = 0;

  constructor() {
    if (typeof window !== 'undefined') {
      this.defaultTitle = document.title || this.defaultTitle;
      this.isTabActive = !document.hidden;

      document.addEventListener('visibilitychange', () => {
        this.isTabActive = !document.hidden;
        if (this.isTabActive) {
          this.stopTabFlashing();
        }
      });

      window.addEventListener('focus', () => {
        this.isTabActive = true;
        this.stopTabFlashing();
      });
    }
  }

  // --------------------------------------------------------------------------
  // Permission Management
  // --------------------------------------------------------------------------
  public isSupported(): boolean {
    return typeof window !== 'undefined' && 'Notification' in window;
  }

  public getPermission(): NotificationPermission {
    if (!this.isSupported()) return 'denied';
    return Notification.permission;
  }

  public async requestPermission(): Promise<NotificationPermission> {
    if (!this.isSupported()) return 'denied';
    try {
      const permission = await Notification.requestPermission();
      return permission;
    } catch (e) {
      console.warn('[BrowserNotification] Error requesting permission:', e);
      return 'denied';
    }
  }

  // --------------------------------------------------------------------------
  // Show Desktop Notification
  // --------------------------------------------------------------------------
  public showNotification(options: BrowserNotificationOptions): Notification | null {
    if (!this.isSupported()) return null;

    if (Notification.permission === 'granted') {
      try {
        const notif = new Notification(options.title, {
          body: options.body,
          icon: options.icon || '/favicon.ico',
          badge: '/favicon.ico',
          tag: options.tag || 'syncora-alert',
        });

        notif.onclick = () => {
          try {
            window.focus();
            notif.close();
          } catch {}
          if (options.onClick) {
            options.onClick();
          }
        };

        // Auto close standard notification after 6 seconds
        setTimeout(() => {
          try {
            notif.close();
          } catch {}
        }, 6000);

        return notif;
      } catch (err) {
        console.warn('[BrowserNotification] Failed to create Notification instance:', err);
      }
    }
    return null;
  }

  // --------------------------------------------------------------------------
  // Tab Title Flashing & Badges (Visible when user is on another tab)
  // --------------------------------------------------------------------------
  public flashTabTitle(alertText: string, customDefault?: string) {
    if (typeof window === 'undefined') return;

    if (customDefault) {
      this.defaultTitle = customDefault;
    }

    this.stopTabFlashing();

    let toggle = false;
    document.title = alertText;

    this.flashingInterval = window.setInterval(() => {
      // If tab is currently active and focused, stop flashing
      if (!document.hidden && document.hasFocus()) {
        this.stopTabFlashing();
        return;
      }

      document.title = toggle ? alertText : (this.defaultTitle || 'Syncora');
      toggle = !toggle;
    }, 1200);
  }

  public stopTabFlashing() {
    if (this.flashingInterval !== null) {
      clearInterval(this.flashingInterval);
      window.clearInterval(this.flashingInterval);
      this.flashingInterval = null;
    }
    if (typeof window !== 'undefined') {
      document.title = this.defaultTitle || 'Syncora — Real-Time Team Collaboration & AI Workspace';
    }
  }

  public setTabBadge(count: number, label?: string) {
    this.pendingUnreadCount = count;
    if (typeof window === 'undefined') return;

    if (count > 0) {
      const prefix = `(${count}) `;
      const titleLabel = label ? `${prefix}${label} • Syncora` : `${prefix}Syncora`;
      this.flashTabTitle(titleLabel);
    } else {
      this.stopTabFlashing();
    }
  }

  public isBackgrounded(): boolean {
    return typeof document !== 'undefined' && (document.hidden || !document.hasFocus());
  }
}

export const browserNotification = new BrowserNotificationManager();
