// frontend/src/store/settingsStore.js
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const useSettingsStore = create(
  persist(
    (set, get) => ({
      // ============ CHART SETTINGS ============
      chart: {
        // Chart Type
        defaultChartType: 'candles', // 'candles' | 'bars' | 'line'
        defaultTimeframe: '15m',
        
        // Display Options
        showGrid: true,
        showVolume: true,
        showTradeHistory: true,
        showTradeLevels: true, // SL/TP lines
        showOHLC: true,
        showDataWindow: false,
        showPeriodSeparators: true,
        showBidAskLines: true,
        
        // Colors
        colors: {
          background: '#131722',
          foreground: '#d1d4dc',
          grid: '#1e222d',
          barUp: '#26a69a',
          barDown: '#ef5350',
          bullCandle: '#26a69a',
          bearCandle: '#ef5350',
          wickUp: '#26a69a',
          wickDown: '#ef5350',
          line: '#2962ff',
          volume: '#787b86',
          bidLine: '#26a69a',
          askLine: '#ef5350',
          crosshair: '#758696',
        },
        
        // Trading
        oneClickTrading: false,
        confirmTrades: true,
        defaultVolume: 0.01,
        defaultSlippage: 3, // points
        
        // Auto Features
        autoScroll: true,
        chartShift: true, // Empty space on right
        magnetMode: true, // Snap drawing tools
      },

      // ============ QUOTES SETTINGS ============
      quotes: {
        viewMode: 'advanced', // 'simple' | 'advanced'
        showSpread: true,
        showChange: true,
        showHighLow: true,
        showTime: true,
        autoArrange: false,
        highlightChanges: true,
        flashOnChange: true,
        
        // Symbol Groups Display
        showForex: true,
        showStocks: true,
        showIndices: true,
        showCrypto: true,
        showCommodities: true,
        showMetals: true,
        
        // Refresh Rate
        refreshRate: 1000, // milliseconds
      },

      // ============ TRADE SETTINGS ============
      trade: {
        // Default Values
        defaultOrderType: 'market',
        defaultVolume: 0.01,
        volumeStep: 0.01,
        
        // SL/TP
        defaultStopLoss: 0,
        defaultTakeProfit: 0,
        slTpMode: 'price', // 'price' | 'points' | 'money'
        
        // Risk Management
        maxOpenPositions: 10,
        maxLotSize: 10,
        riskPerTrade: 2, // Percentage
        
        // Confirmations
        confirmMarketOrders: true,
        confirmPendingOrders: true,
        confirmClosePositions: true,
        confirmCloseAll: true,
        
        // Fill Policy
        fillPolicy: 'fok', // 'fok' | 'ioc' | 'return'
        
        // Order Expiration
        defaultExpiration: 'gtc', // 'gtc' | 'today' | 'specified'
      },

      // ============ NOTIFICATION SETTINGS ============
      notifications: {
        // Push Notifications
        pushEnabled: true,
        
        // Sound
        soundEnabled: true,
        soundVolume: 80, // 0-100
        
        // Vibration (Mobile)
        vibrationEnabled: true,
        
        // Alert Types
        tradeAlerts: true,
        orderAlerts: true,
        priceAlerts: true,
        newsAlerts: true,
        marginAlerts: true,
        stopOutAlerts: true,
        
        // Price Alerts List
        priceAlertsList: [],
        
        // Do Not Disturb
        dndEnabled: false,
        dndStart: '22:00',
        dndEnd: '08:00',
      },

      // ============ INTERFACE SETTINGS ============
      interface: {
        // Theme
        theme: 'dark', // 'dark' | 'light'
        
        // Language
        language: 'en',
        
        // Font Size
        fontSize: 'medium', // 'small' | 'medium' | 'large'
        
        // Date/Time Format
        dateFormat: 'DD/MM/YYYY',
        timeFormat: '24h', // '12h' | '24h'
        timezone: 'Asia/Kolkata',
        
        // Number Format
        decimalSeparator: '.',
        thousandsSeparator: ',',
        
        // Layout
        showHeader: true,
        compactMode: false,
        animationsEnabled: true,
        
        // Tooltips
        showTooltips: true,
      },

      // ============ SECURITY SETTINGS ============
      security: {
        // Auto Lock
        autoLockEnabled: false,
        autoLockTimeout: 5, // minutes
        
        // Biometric
        biometricEnabled: false,
        
        // Session
        rememberLogin: true,
        sessionTimeout: 60, // minutes
        
        // 2FA
        twoFactorEnabled: false,
        twoFactorMethod: 'app', // 'app' | 'sms' | 'email'
      },

      // ============ DATA & PRIVACY ============
      dataPrivacy: {
        // Analytics
        analyticsEnabled: true,
        crashReportsEnabled: true,
        
        // Trading Data
        saveTradeHistory: true,
        saveChartData: true,
        
        // Clear Data
        lastCacheClear: null,
      },

      // ============ ACTIONS ============
      
      // Update chart settings
      updateChartSettings: (updates) => {
        set((state) => ({
          chart: { ...state.chart, ...updates },
        }));
      },

      // Update chart colors
      updateChartColors: (colorUpdates) => {
        set((state) => ({
          chart: {
            ...state.chart,
            colors: { ...state.chart.colors, ...colorUpdates },
          },
        }));
      },

      // Update quotes settings
      updateQuotesSettings: (updates) => {
        set((state) => ({
          quotes: { ...state.quotes, ...updates },
        }));
      },

      // Update trade settings
      updateTradeSettings: (updates) => {
        set((state) => ({
          trade: { ...state.trade, ...updates },
        }));
      },

      // Update notification settings
      updateNotificationSettings: (updates) => {
        set((state) => ({
          notifications: { ...state.notifications, ...updates },
        }));
      },

      // Add price alert
      addPriceAlert: (alert) => {
        const { symbol, price, condition, message } = alert;
        const newAlert = {
          id: Date.now().toString(),
          symbol,
          price,
          condition, // 'above' | 'below' | 'cross'
          message: message || `${symbol} ${condition} ${price}`,
          enabled: true,
          triggered: false,
          createdAt: new Date().toISOString(),
        };

        set((state) => ({
          notifications: {
            ...state.notifications,
            priceAlertsList: [...state.notifications.priceAlertsList, newAlert],
          },
        }));

        return newAlert;
      },

      // Remove price alert
      removePriceAlert: (alertId) => {
        set((state) => ({
          notifications: {
            ...state.notifications,
            priceAlertsList: state.notifications.priceAlertsList.filter(
              (a) => a.id !== alertId
            ),
          },
        }));
      },

      // Toggle price alert
      togglePriceAlert: (alertId) => {
        set((state) => ({
          notifications: {
            ...state.notifications,
            priceAlertsList: state.notifications.priceAlertsList.map((a) =>
              a.id === alertId ? { ...a, enabled: !a.enabled } : a
            ),
          },
        }));
      },

      // Update interface settings
      updateInterfaceSettings: (updates) => {
        set((state) => ({
          interface: { ...state.interface, ...updates },
        }));
      },

      // Toggle theme
      toggleTheme: () => {
        set((state) => ({
          interface: {
            ...state.interface,
            theme: state.interface.theme === 'dark' ? 'light' : 'dark',
          },
        }));
      },

      // Set language
      setLanguage: (language) => {
        set((state) => ({
          interface: { ...state.interface, language },
        }));
      },

      // Update security settings
      updateSecuritySettings: (updates) => {
        set((state) => ({
          security: { ...state.security, ...updates },
        }));
      },

      // Update data privacy settings
      updateDataPrivacySettings: (updates) => {
        set((state) => ({
          dataPrivacy: { ...state.dataPrivacy, ...updates },
        }));
      },

      // Clear cache
      clearCache: () => {
        // Clear localStorage except for this store
        const keysToKeep = ['settings-storage'];
        Object.keys(localStorage).forEach((key) => {
          if (!keysToKeep.includes(key)) {
            localStorage.removeItem(key);
          }
        });

        set((state) => ({
          dataPrivacy: {
            ...state.dataPrivacy,
            lastCacheClear: new Date().toISOString(),
          },
        }));
      },

      // Enable one-click trading
      enableOneClickTrading: () => {
        set((state) => ({
          chart: {
            ...state.chart,
            oneClickTrading: true,
            confirmTrades: false,
          },
        }));
      },

      // Disable one-click trading
      disableOneClickTrading: () => {
        set((state) => ({
          chart: {
            ...state.chart,
            oneClickTrading: false,
            confirmTrades: true,
          },
        }));
      },

      // Reset chart settings to default
      resetChartSettings: () => {
        set((state) => ({
          chart: {
            defaultChartType: 'candles',
            defaultTimeframe: '15m',
            showGrid: true,
            showVolume: true,
            showTradeHistory: true,
            showTradeLevels: true,
            showOHLC: true,
            showDataWindow: false,
            showPeriodSeparators: true,
            showBidAskLines: true,
            colors: {
              background: '#131722',
              foreground: '#d1d4dc',
              grid: '#1e222d',
              barUp: '#26a69a',
              barDown: '#ef5350',
              bullCandle: '#26a69a',
              bearCandle: '#ef5350',
              wickUp: '#26a69a',
              wickDown: '#ef5350',
              line: '#2962ff',
              volume: '#787b86',
              bidLine: '#26a69a',
              askLine: '#ef5350',
              crosshair: '#758696',
            },
            oneClickTrading: false,
            confirmTrades: true,
            defaultVolume: 0.01,
            defaultSlippage: 3,
            autoScroll: true,
            chartShift: true,
            magnetMode: true,
          },
        }));
      },

      // Reset all settings to default
      resetAllSettings: () => {
        set({
          chart: {
            defaultChartType: 'candles',
            defaultTimeframe: '15m',
            showGrid: true,
            showVolume: true,
            showTradeHistory: true,
            showTradeLevels: true,
            showOHLC: true,
            showDataWindow: false,
            showPeriodSeparators: true,
            showBidAskLines: true,
            colors: {
              background: '#131722',
              foreground: '#d1d4dc',
              grid: '#1e222d',
              barUp: '#26a69a',
              barDown: '#ef5350',
              bullCandle: '#26a69a',
              bearCandle: '#ef5350',
              wickUp: '#26a69a',
              wickDown: '#ef5350',
              line: '#2962ff',
              volume: '#787b86',
              bidLine: '#26a69a',
              askLine: '#ef5350',
              crosshair: '#758696',
            },
            oneClickTrading: false,
            confirmTrades: true,
            defaultVolume: 0.01,
            defaultSlippage: 3,
            autoScroll: true,
            chartShift: true,
            magnetMode: true,
          },
          quotes: {
            viewMode: 'advanced',
            showSpread: true,
            showChange: true,
            showHighLow: true,
            showTime: true,
            autoArrange: false,
            highlightChanges: true,
            flashOnChange: true,
            showForex: true,
            showStocks: true,
            showIndices: true,
            showCrypto: true,
            showCommodities: true,
            showMetals: true,
            refreshRate: 1000,
          },
          trade: {
            defaultOrderType: 'market',
            defaultVolume: 0.01,
            volumeStep: 0.01,
            defaultStopLoss: 0,
            defaultTakeProfit: 0,
            slTpMode: 'price',
            maxOpenPositions: 10,
            maxLotSize: 10,
            riskPerTrade: 2,
            confirmMarketOrders: true,
            confirmPendingOrders: true,
            confirmClosePositions: true,
            confirmCloseAll: true,
            fillPolicy: 'fok',
            defaultExpiration: 'gtc',
          },
          notifications: {
            pushEnabled: true,
            soundEnabled: true,
            soundVolume: 80,
            vibrationEnabled: true,
            tradeAlerts: true,
            orderAlerts: true,
            priceAlerts: true,
            newsAlerts: true,
            marginAlerts: true,
            stopOutAlerts: true,
            priceAlertsList: [],
            dndEnabled: false,
            dndStart: '22:00',
            dndEnd: '08:00',
          },
          interface: {
            theme: 'dark',
            language: 'en',
            fontSize: 'medium',
            dateFormat: 'DD/MM/YYYY',
            timeFormat: '24h',
            timezone: 'Asia/Kolkata',
            decimalSeparator: '.',
            thousandsSeparator: ',',
            showHeader: true,
            compactMode: false,
            animationsEnabled: true,
            showTooltips: true,
          },
          security: {
            autoLockEnabled: false,
            autoLockTimeout: 5,
            biometricEnabled: false,
            rememberLogin: true,
            sessionTimeout: 60,
            twoFactorEnabled: false,
            twoFactorMethod: 'app',
          },
          dataPrivacy: {
            analyticsEnabled: true,
            crashReportsEnabled: true,
            saveTradeHistory: true,
            saveChartData: true,
            lastCacheClear: null,
          },
        });
      },

      // Export settings
      exportSettings: () => {
        const state = get();
        const exportData = {
          chart: state.chart,
          quotes: state.quotes,
          trade: state.trade,
          notifications: {
            ...state.notifications,
            priceAlertsList: [], // Don't export alerts
          },
          interface: state.interface,
          exportedAt: new Date().toISOString(),
          version: '1.0.0',
        };

        return JSON.stringify(exportData, null, 2);
      },

      // Import settings
      importSettings: (jsonString) => {
        try {
          const importData = JSON.parse(jsonString);

          if (!importData.version) {
            throw new Error('Invalid settings file');
          }

          set((state) => ({
            chart: { ...state.chart, ...importData.chart },
            quotes: { ...state.quotes, ...importData.quotes },
            trade: { ...state.trade, ...importData.trade },
            interface: { ...state.interface, ...importData.interface },
          }));

          return { success: true, message: 'Settings imported successfully' };
        } catch (error) {
          return { success: false, message: error.message };
        }
      },

      // Get setting value by path
      getSetting: (path) => {
        const state = get();
        const parts = path.split('.');
        let value = state;

        for (const part of parts) {
          if (value && typeof value === 'object' && part in value) {
            value = value[part];
          } else {
            return undefined;
          }
        }

        return value;
      },

      // Set setting value by path
      setSetting: (path, value) => {
        const parts = path.split('.');
        const category = parts[0];
        const key = parts.slice(1).join('.');

        if (parts.length === 2) {
          set((state) => ({
            [category]: {
              ...state[category],
              [parts[1]]: value,
            },
          }));
        } else if (parts.length === 3) {
          set((state) => ({
            [category]: {
              ...state[category],
              [parts[1]]: {
                ...state[category][parts[1]],
                [parts[2]]: value,
              },
            },
          }));
        }
      },
    }),
    {
      name: 'settings-storage', // LocalStorage key
      version: 1,
      partialize: (state) => ({
        chart: state.chart,
        quotes: state.quotes,
        trade: state.trade,
        notifications: state.notifications,
        interface: state.interface,
        security: state.security,
        dataPrivacy: state.dataPrivacy,
      }),
    }
  )
);

export default useSettingsStore;