/*
 * Boots the TradingView widget once the Qt WebChannel bridge is ready.
 * The native app selects the symbol (watchlist) -> bridge.symbolChanged ->
 * chart follows; the native light/dark switch -> bridge.themeChanged.
 */
(function () {
  // Candle colours stay put across themes (green up / red down); only the
  // surfaces and axis type flip.
  function overridesFor(theme, compact) {
    const light = theme === "light";
    return {
      // Split view: drop the "Bitcoin / US Dollar · 5 · Vxness" line from the
      // legend. The pane header above it already names the instrument, so in a
      // half or quarter pane it is a second copy of the same fact sitting on
      // top of the candles. The OHLC row underneath is left alone — that IS
      // data, and it has no other home on the chart.
      //
      // A legend property rather than the `legend_widget` feature: that flag
      // removes the whole block, OHLC included.
      "paneProperties.legendProperties.showSeriesTitle": !compact,
      "paneProperties.background": light ? "#ffffff" : "#0e0f13",
      "paneProperties.backgroundType": "solid",
      "paneProperties.vertGridProperties.color": light ? "#eef1f5" : "#191b20",
      "paneProperties.horzGridProperties.color": light ? "#eef1f5" : "#191b20",
      "scalesProperties.textColor": light ? "#6b7280" : "#8a8f98",
      "scalesProperties.lineColor": light ? "#dfe3ea" : "#2a2d34",
      "mainSeriesProperties.candleStyle.upColor": "#26a269",
      "mainSeriesProperties.candleStyle.downColor": "#e01b24",
      "mainSeriesProperties.candleStyle.borderUpColor": "#26a269",
      "mainSeriesProperties.candleStyle.borderDownColor": "#e01b24",
      "mainSeriesProperties.candleStyle.wickUpColor": "#26a269",
      "mainSeriesProperties.candleStyle.wickDownColor": "#e01b24",
    };
  }

  const surfaceFor = (t) => (t === "light" ? "#ffffff" : "#0e0f13");

  /*
   * Vxness watermark, centred on the chart canvas.
   *
   * Built as our own DOM layer rather than through the library: the charting
   * library's symbolWatermark only draws the SYMBOL text, and there is no hook
   * for a custom image. This sits above the chart iframe but below the position
   * overlay (z-index 5 vs 20) and is transparent to the pointer, so drawing,
   * dragging SL/TP and the crosshair all behave exactly as before.
   *
   * Only the emblem is an image — the wordmark's type is black and would
   * vanish on the dark theme, so the name is real text that takes the theme
   * colour instead. The emblem has the same problem (its ring is black brush
   * strokes), so it ships in two colourways and the theme picks one.
   */
  function ensureWatermark(theme) {
    let el = document.getElementById("tx_watermark");
    if (!el) {
      el = document.createElement("div");
      el.id = "tx_watermark";
      el.style.cssText =
        "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;" +
        "gap:20px;pointer-events:none;user-select:none;z-index:5;";

      const img = document.createElement("img");
      img.id = "tx_watermark_mark";
      img.alt = "";
      img.style.cssText = "width:88px;height:88px;";

      const txt = document.createElement("span");
      txt.id = "tx_watermark_text";
      txt.textContent = "Vxness";
      txt.style.cssText =
        "font:800 44px -apple-system,'Segoe UI',sans-serif;letter-spacing:0.5px;";

      el.appendChild(img);
      el.appendChild(txt);
      document.body.appendChild(el);
    }
    // Faint enough that candles and grid lines stay fully readable through it.
    el.style.opacity = theme === "light" ? "0.09" : "0.12";
    document.getElementById("tx_watermark_mark").src =
      theme === "light" ? "vxness-mark.png" : "vxness-mark-light.png";
    document.getElementById("tx_watermark_text").style.color =
      theme === "light" ? "#0d1117" : "#e6e8ec";
  }

  let widget = null;
  let datafeed = null;
  // MetaTrader's chart right-click menu — see tx_chartmenu.js. Built once and
  // kept across rebuilds: it reads the live `widget` through the getter below
  // rather than holding a chart of its own.
  let chartMenu = null;
  let bridgeRef = null;
  // True only between onChartReady and the next rebuild. widget is non-null
  // well before the chart will accept a load(), so a profile restored while the
  // pane is still building has to wait — see applyChartState().
  let chartReady = false;
  // A workspace profile's state for this pane, held until the chart can take
  // it. Loading a profile that also changes the theme rebuilds every pane, and
  // without this the restore would land in the gap and be lost.
  let pendingState = null;

  /*
   * Save / load adapter for the charting library.
   *
   * This is what makes "Save chart", indicator templates and drawing templates
   * real: without an adapter the library has nowhere to keep any of them, so
   * the terminal disabled the header button rather than show one that could
   * not work — and a trader's fibs and indicators died with the window.
   *
   * Storage is the C++ side (sc.*), which keeps one JSON file beside
   * config.json. So a template saved on one pane is offered on all four, and
   * everything survives a restart.
   *
   * Every method returns a Promise because the library awaits them, and every
   * bridge call is wrapped in one because QWebChannel methods are ASYNCHRONOUS
   * — a bridge call returns undefined and delivers its result to a callback.
   * Returning `sc.listCharts()` directly would hand the library undefined and
   * look exactly like an empty, broken store.
   */
  function call(fn, ...args) {
    return new Promise((resolve) => {
      try {
        fn.call(bridgeRef, ...args, (result) => resolve(result));
      } catch (e) {
        console.warn("save/load bridge call failed", e);
        resolve(undefined);
      }
    });
  }

  const parseJson = (text, fallback) => {
    try { return text ? JSON.parse(text) : fallback; } catch (e) { return fallback; }
  };

  function makeSaveLoadAdapter(bridge) {
    return {
      getAllCharts: () =>
        call(bridge.listCharts).then((t) => parseJson(t, [])),
      removeChart: (id) => call(bridge.removeChart, String(id)),
      saveChart: (chartData) =>
        call(bridge.saveChart,
             chartData.id === undefined || chartData.id === null ? "" : String(chartData.id),
             chartData.name || "Untitled",
             chartData.symbol || "",
             String(chartData.resolution || ""),
             chartData.content || ""),
      getChartContent: (id) => call(bridge.chartContent, String(id)),

      // Indicator templates — MT5 calls these chart templates, and they are
      // what a trader means by "save my setup and put it on another chart".
      getAllStudyTemplates: () =>
        call(bridge.listStudyTemplates)
          .then((t) => parseJson(t, []).map((name) => ({ name }))),
      // Drops the drawings alongside — see saveStudyTemplate below.
      removeStudyTemplate: (info) => call(bridge.removeStudyTemplate, info.name),

      /*
       * "Save Indicator template…" — and the drawings with it.
       *
       * The desk asked for templates that keep every indicator AND every tool
       * on the chart, and sent a screenshot of this dialog as the place they
       * save them. `data.content` holds the indicators and nothing else: the
       * library builds it and offers no way to include drawings.
       *
       * So the drawings are captured here, from the same chart at the same
       * moment, and stored beside it under the same name. getLineToolsState()
       * touches the drawings only, which is what lets the library go on owning
       * the indicator half exactly as before.
       *
       * The instrument and timeframe are stripped on the C++ side, in the one
       * place templates are written — see ChartBridge::saveStudyTemplate.
       */
      saveStudyTemplate: (data) => {
        let drawings = "";
        try {
          drawings = JSON.stringify(widget.activeChart().getLineToolsState());
        } catch (e) {
          // A chart with nothing drawn on it, or one still loading. An empty
          // string is stored on purpose: it has to CLEAR whatever a previous
          // template of this name carried.
          console.warn("template: could not read the drawings", e);
        }
        return call(bridge.saveStudyTemplate, data.name, data.content)
          .then(() => call(bridge.saveTemplateDrawings, data.name, drawings));
      },

      /*
       * Loading one puts the drawings back first, then hands the indicators to
       * the library, which applies them as it always has.
       *
       * Order matters only in that both must happen; they touch different
       * things. A template saved before this shipped simply has no drawings
       * stored, and loads as it used to.
       */
      getStudyTemplateContent: (info) =>
        call(bridge.templateDrawings, info.name)
          .then((text) => {
            const state = parseJson(text, null);
            if (!state) return;
            try {
              return widget.activeChart().applyLineToolsState(state);
            } catch (e) {
              console.warn("template: the chart refused the drawings", e);
            }
          })
          .then(() => call(bridge.studyTemplateContent, info.name)),

      // Chart templates carry the STYLE (candle colours, scales, background).
      // Stored as text and parsed back here, because the library hands this
      // one over as an object rather than a string.
      getAllChartTemplates: () =>
        call(bridge.listChartTemplates).then((t) => parseJson(t, [])),
      saveChartTemplate: (name, theme) =>
        call(bridge.saveChartTemplate, name, JSON.stringify(theme)),
      removeChartTemplate: (name) => call(bridge.removeChartTemplate, name),
      getChartTemplateContent: (name) =>
        call(bridge.chartTemplateContent, name).then((t) => parseJson(t, {})),

      getDrawingTemplates: (tool) =>
        call(bridge.listDrawingTemplates, tool).then((t) => parseJson(t, [])),
      loadDrawingTemplate: (tool, name) =>
        call(bridge.drawingTemplateContent, tool, name),
      saveDrawingTemplate: (tool, name, content) =>
        call(bridge.saveDrawingTemplate, tool, name, content),
      removeDrawingTemplate: (tool, name) =>
        call(bridge.removeDrawingTemplate, tool, name),

      // Only reached with saveload_separate_drawings_storage enabled, which
      // this build does not turn on: drawings travel inside the layout content
      // above. Present because the adapter interface is all-or-nothing, and a
      // missing method throws rather than degrading.
      saveLineToolsAndGroups: () => Promise.resolve(),
      loadLineToolsAndGroups: () => Promise.resolve(null),
    };
  }


  /*
   * Builds the chart in `theme`, replacing any existing one.
   *
   * The whole widget is rebuilt rather than calling changeTheme(), because
   * `toolbar_bg` and `loading_screen` are CONSTRUCTOR-ONLY options: after a
   * changeTheme() the chart pane repainted but the left drawing toolbar and the
   * bottom timeframe bar kept the old theme's background, leaving their icons
   * dark-on-dark and effectively invisible in light mode.
   *
   * The datafeed is deliberately NOT rebuilt — it owns bridge signal handlers
   * (barsReady / symbolsChanged / tick) that would stack up on every switch.
   */
  function createChart(bridge, theme) {
    const t = theme === "light" ? "light" : "dark";
    // Read live rather than taking it as an argument: createChart is also
    // called from themeChanged, which knows nothing about the grid.
    const compact = !!bridge.compact;
    // View > Data Window. The library's own widget-bar panel, which is the only
    // thing that knows every indicator's value at the crosshair.
    const dataWindow = !!bridge.dataWindow;
    const surface = surfaceFor(t);
    document.body.style.background = surface;
    // Lives outside the widget, so a theme rebuild only restyles it.
    ensureWatermark(t);
    // A rebuild throws the chart's overrides away, so the menu's idea of
    // whether the grid is on has to go back to the default with them.
    if (chartMenu) chartMenu.reset();

    // Carry the user's current view across the rebuild.
    let symbol = bridge.currentSymbol || "EURUSD";
    let interval = "5";
    if (widget) {
      try {
        const ch = widget.activeChart();
        symbol = ch.symbol() || symbol;
        interval = ch.resolution() || interval;
      } catch (e) { /* chart not ready — fall back to the defaults */ }
    }

    chartReady = false;

    // Tear the old one down first: the overlay holds a rAF loop, bridge signal
    // handlers and a DOM layer, all of which must go with its chart.
    if (window.txPositions && window.txPositions.destroy) {
      try { window.txPositions.destroy(); } catch (e) { console.warn("overlay destroy", e); }
    }
    window.txPositions = null;
    if (widget) {
      try { widget.remove(); } catch (e) { console.warn("widget remove", e); }
      widget = null;
    }

    widget = new TradingView.widget({
      container: "tv_chart",
      library_path: "vendor/charting_library/",
      datafeed: datafeed,
      symbol: symbol,
      interval: interval,
      timezone: "Etc/UTC",
      theme: t,
      autosize: true,
      locale: "en",
      toolbar_bg: surface,
      loading_screen: { backgroundColor: surface, foregroundColor: "#2d6df6" },
      // NOTE: deliberately no broker_factory. The vendored charting_library is
      // the *Advanced Charts* build, where the Broker API and native position
      // lines are disabled ("only available on Trading Platform"). Position
      // lines are drawn by our own overlay instead — see tx_positions.js.
      // (tx_broker.js stays ready for the day a Trading Platform build lands
      // in vendor/.)
      // Saved layouts and templates go through our own adapter, into a file
      // beside config.json. No TradingView account and no server is involved.
      save_load_adapter: makeSaveLoadAdapter(bridge),
      // MetaTrader's menu on the candles, in place of the library's own. A
      // constructor option, which is why the rebuild paths below re-apply it
      // for free. See tx_chartmenu.js.
      ...(chartMenu ? { context_menu: chartMenu.options } : {}),
      // The library needs a layout name to show in the header before the first
      // save; it renames itself as soon as one is saved.
      saved_data_meta_info: { uid: 1, name: "Vxness", description: "" },
      // The widget bar down the right of the chart. Only the Data Window is
      // turned on — watchlist, news and details all duplicate panels the
      // terminal already has natively. Constructor-only, like the compact
      // features below, which is why toggling it rebuilds the chart.
      ...(dataWindow ? { widgetbar: { datawindow: true } } : {}),
      // Makes the library raise onAutoSaveNeeded a couple of seconds after the
      // trader changes something. That event is what keeps C++'s copy of this
      // pane's state current, so File > Profile > Save Profile can capture the
      // timeframe, the indicators and the drawings without an async round trip.
      // Nothing is written to disk on this timer — see pushChartState().
      auto_save_delay: 2,
      // Quick-access timeframe buttons in the header (1m 3m 5m … D W M),
      // matching the web terminal's toolbar.
      favorites: {
        intervals: ["1", "3", "5", "10", "15", "30", "45", "60", "120", "180", "240", "1D", "1W", "1M"],
      },
      disabled_features: [
        "use_localstorage_for_settings",
        // The Save / Load LAYOUT menu stays off. A saved layout carries the
        // instrument and the interval with it, so loading one on a second
        // chart dragged that chart onto the first chart's symbol — reported
        // from the desk as "once save in template same symbol get in chart".
        // Indicator templates are the thing a trader actually wants to reuse
        // across instruments, and those are enabled below.
        "header_saveload",
        "header_compare",
        // Split view (2 or 4 panes): drop the drawing toolbar down the left and
        // the date-range bar along the bottom. Both are worth their space on a
        // full-window chart; in a quarter pane they take most of the height and
        // width that the candles need. sc.compact is set by ChartArea whenever
        // the grid crosses between one pane and several.
        //
        // These are CONSTRUCTOR-ONLY, like toolbar_bg — there is no runtime API
        // to toggle a feature, which is why compactChanged rebuilds the widget
        // rather than flipping something on the live chart.
        ...(compact ? ["left_toolbar", "timeframes_toolbar"] : []),
      ],
      // Left drawing toolbar stays open on a single full-size chart.
      // study_templates is what puts "Save Indicator Template" in the
      // Indicators dialog; it is off unless asked for.
      enabled_features: ["study_templates"],
      overrides: overridesFor(t, compact),
    });

    window.tvWidget = widget;

    // Draw open positions on the chart: entry line + draggable SL/TP lines
    // wired to the real server position, plus a ✕ close control.
    window.txPositions = window.makePositionOverlay(widget, bridge);

    widget.onChartReady(() => {
      chartReady = true;
      const l = document.getElementById("loading");
      if (l) l.style.display = "none";

      // A profile was loaded while this pane was rebuilding. Apply it before
      // anything else touches the chart, and before the first state push below
      // — otherwise the pane would report the state it is about to discard.
      if (pendingState) {
        const s = pendingState;
        pendingState = null;
        try {
          widget.load(s);
        } catch (e) {
          console.warn("profile: the chart refused the saved state", e);
        }
      }
      // Re-attached per widget: a theme switch rebuilds the chart, and with it
      // the iframe the observer was watching.
      watchDialogs(bridge);

      // Tell the native side when the symbol is changed from inside the chart
      // — the library's own search box, or the symbol field on its toolbar.
      //
      // Nothing reported those before, so C++ went on filtering ticks to the
      // symbol the Market Watch had selected. The newly picked one drew its
      // history and then froze: no live candle, and the datafeed holds bars
      // back until a tick arrives to establish the spread, so often nothing
      // appeared at all. To a trader the chart simply did not change.
      try {
        widget.activeChart().onSymbolChanged().subscribe(null, () => {
          try {
            const s = widget.activeChart().symbol();
            if (s) bridge.chartSymbolPicked(s);
          } catch (e) { /* chart torn down mid-callback */ }
        });
      } catch (e) {
        console.warn("onSymbolChanged subscribe failed", e);
      }

      // Same thing for the timeframe, which the native toolbar's M1…MN buttons
      // highlight. The chart's own header and its keyboard shortcuts change it
      // too, so the highlight has to follow the chart rather than the last
      // button that was clicked. Seeded once here as well: a pane restored from
      // a profile opens on the saved timeframe, which no click ever announced.
      try {
        const seed = widget.activeChart().resolution();
        if (seed) bridge.chartResolutionPicked(String(seed));
        widget.activeChart().onIntervalChanged().subscribe(null, (interval) => {
          try {
            if (interval) bridge.chartResolutionPicked(String(interval));
          } catch (e) { /* chart torn down mid-callback */ }
        });
      } catch (e) {
        console.warn("onIntervalChanged subscribe failed", e);
      }

      // Seed the native side's copy of this pane's state, then keep it current.
      // The first push matters on its own: a profile saved before the trader
      // touches the chart still has to bring back the symbol and timeframe.
      pushChartState(bridge);

      // Hand the navigator the indicators this build can draw. Read from the
      // library rather than listed in C++, so it can never disagree with the
      // vendor bundle sitting in web/vendor.
      try {
        const studies = widget.getStudiesList();
        if (Array.isArray(studies)) bridge.pushStudies(JSON.stringify(studies));
      } catch (e) {
        console.warn("could not read the indicator list", e);
      }

      try {
        widget.subscribe("onAutoSaveNeeded", () => pushChartState(bridge));
      } catch (e) {
        console.warn("onAutoSaveNeeded subscribe failed", e);
      }
    });
  }

  /*
   * Hands C++ this pane's full chart state — symbol, timeframe, indicators,
   * drawings, chart style — for File > Profile. The library only surrenders it
   * through a callback, so this cannot be a getter; C++ caches whatever arrives
   * and reads the cache when a profile is saved.
   */
  function pushChartState(bridge) {
    if (!widget) return;
    try {
      widget.save((state) => {
        try {
          bridge.pushChartState(JSON.stringify(state));
        } catch (e) {
          console.warn("profile: could not hand state to the terminal", e);
        }
      });
    } catch (e) {
      // Chart torn down between the event and the save — nothing to keep.
    }
  }

  /*
   * Watches the chart for open dialogs (Indicators, chart settings, symbol
   * search …) and tells the native side to hide the one-click strip while one
   * is up.
   *
   * Why this is needed: the charting library renders its dialogs INSIDE its own
   * iframe. Anything in this document — the watermark, and the native Qt strip
   * floating over the web view — paints above that iframe's content, so a
   * dialog could never come out in front. Nothing about z-index can fix it from
   * our side; the covering elements have to get out of the way instead.
   *
   * The iframe is same-origin (both file://, and LocalContentCanAccessFileUrls
   * is enabled), so its document is reachable. If that ever stops being true we
   * log it and simply keep the old behaviour rather than breaking the chart.
   */
  function watchDialogs(bridge) {
    const host = document.getElementById("tv_chart");
    const frame = host && host.querySelector("iframe");
    let doc = null;
    try {
      doc = frame && (frame.contentDocument || (frame.contentWindow || {}).document);
    } catch (e) { /* cross-origin — handled below */ }
    if (!doc || !doc.body) {
      console.warn("dialog watch: chart iframe document unavailable; strip will not auto-hide");
      return;
    }

    // Two families to catch, with several selectors each because the library
    // has changed this markup across versions and a missed match means a
    // covered popup again:
    //   - modal dialogs   (Indicators, chart settings, symbol search)
    //   - dropdown menus  (the interval "5m" picker, the chart-type picker)
    const SEL = [
      '[data-dialog-name]', '[role="dialog"]', '.tv-dialog', '.ui-draggable-dialog',
      '[class*="dialog-"]',
      '[data-name="popup-menu-container"]', '[data-name="menu-inner"]',
      '.tv-dropdown-behavior__body', '[class*="menuWrap"]', '[class*="popupMenu"]'
    ].join(',');

    // Presence is not enough: some of these containers exist permanently and
    // are merely empty when closed, which would pin the strip hidden forever.
    // Require something actually laid out on screen.
    function anythingOpen() {
      const nodes = doc.querySelectorAll(SEL);
      for (let i = 0; i < nodes.length; i++) {
        const r = nodes[i].getBoundingClientRect();
        if (r.width > 1 && r.height > 1) return true;
      }
      return false;
    }

    let last = null;
    function update() {
      const open = anythingOpen();
      if (open === last) return;
      last = open;
      const wm = document.getElementById("tx_watermark");
      if (wm) wm.style.visibility = open ? "hidden" : "visible";
      try { bridge.setOverlayHidden(open); } catch (e) { console.warn("setOverlayHidden", e); }
    }

    // Menus often open by toggling style/class on an existing node rather than
    // inserting one, so attributes are watched too.
    new MutationObserver(update).observe(doc.body, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ["style", "class", "data-name"],
    });

    // Backstop poll. If a single mutation is ever missed the strip would stay
    // hidden with no way back; this guarantees it recovers within a tick.
    if (window.txDialogPoll) clearInterval(window.txDialogPoll);
    window.txDialogPoll = setInterval(update, 400);

    update();
    console.info("dialog watch: attached");

    // The chart menu's keyboard shortcuts live on the same iframe document.
    // Bound here because this is the one place that has already resolved it,
    // and it guards itself against being bound twice.
    if (chartMenu) chartMenu.bindShortcuts(doc);
  }

  function boot(bridge) {
    window.sc = bridge;
    bridgeRef = bridge;
    datafeed = window.makeDatafeed(bridge);
    // The getter, not the widget: createChart replaces `widget` on every theme
    // or layout change, and a captured reference would go on driving the chart
    // that was torn down.
    if (window.makeChartMenu) chartMenu = window.makeChartMenu(bridge, () => widget);
    // Said out loud, because the failure is otherwise silent: without the
    // module the widget is built with no context_menu option at all and the
    // chart quietly keeps the library's own menu.
    console.info(chartMenu ? "chart menu: MetaTrader menu installed"
                           : "chart menu: MISSING — tx_chartmenu.js did not load");
    createChart(bridge, bridge.theme);

    // Registered ONCE, outside createChart — they read the current `widget`, so
    // a rebuild swaps the chart underneath them without stacking handlers.
    bridge.symbolChanged.connect((sym) => {
      if (!sym || !widget) return;
      try {
        // An in-chart pick is reported to C++ and comes straight back here as
        // the property's change notification. Re-applying it would reload the
        // series the trader just chose — and the reload discards the chart's
        // scroll position, so it reads as the chart jumping on its own.
        if (widget.activeChart().symbol() === sym) return;
        widget.activeChart().setSymbol(sym);
      } catch (e) { /* not ready yet */ }
    });
    bridge.themeChanged.connect((theme) => createChart(bridge, theme));
    // Same rebuild path as a theme switch: the features that hide the drawing
    // toolbar and the bottom bar can only be set when the widget is built.
    // ChartBridge::setCompact only emits on an actual change, so switching
    // between 2 and 4 panes does not rebuild anything.
    bridge.compactChanged.connect(() => createChart(bridge, bridge.theme));
    // Same rebuild path: widgetbar is a constructor option with no runtime
    // toggle, exactly like the compact feature set.
    bridge.dataWindowChanged.connect(() => createChart(bridge, bridge.theme));

    // A workspace profile is being loaded: put this pane back the way it was
    // saved. widget.load() restores the symbol, timeframe, indicators and
    // drawings in one go, so nothing else here has to be told about it.
    bridge.chartStateLoad.connect(applyChartState);

    // View > Navigation > Indicators, double-clicked. createStudy takes the
    // library's own study name, which is exactly what getStudiesList handed
    // over, so no mapping is needed in between.
    bridge.studyRequested.connect((name) => {
      if (!name || !widget || !chartReady) return;
      try {
        widget.activeChart().createStudy(name);
      } catch (e) {
        console.warn("could not add the indicator", name, e);
      }
    });

    // The native timeframe buttons above the chart. setResolution is a promise
    // and rejects for a resolution this datafeed cannot serve, so the rejection
    // is caught — an unhandled one shows up in the diagnostic log as a bare
    // "Uncaught (in promise)" with nothing naming the timeframe that caused it.
    bridge.resolutionRequested.connect((res) => {
      if (!res || !widget || !chartReady) return;
      try {
        const p = widget.activeChart().setResolution(String(res));
        if (p && typeof p.catch === "function")
          p.catch((e) => console.warn("the chart refused the timeframe", res, e));
      } catch (e) {
        console.warn("could not set the timeframe", res, e);
      }
    });

    // The native drawing-tool buttons. selectLineTool ARMS a tool: the next
    // click on the candles starts that drawing. "cursor" disarms, which is what
    // the arrow button on the left of the row is for.
    bridge.lineToolRequested.connect((tool) => {
      if (!tool || !widget || !chartReady) return;
      try {
        const p = widget.selectLineTool(String(tool));
        if (p && typeof p.catch === "function")
          p.catch((e) => console.warn("the chart refused the drawing tool", tool, e));
      } catch (e) {
        console.warn("could not select the drawing tool", tool, e);
      }
    });
  }

  /*
   * Restores one pane from a workspace profile, or queues the state until the
   * chart is ready to take it. Loading a profile can change the theme, and a
   * theme change rebuilds the widget — so the state frequently arrives while
   * there is no chart to give it to.
   */
  function applyChartState(json) {
    if (!json) return;
    let state;
    try {
      state = JSON.parse(json);
    } catch (e) {
      console.warn("profile: chart state is not valid JSON", e);
      return;
    }
    if (!widget || !chartReady) {
      pendingState = state;
      return;
    }
    try {
      widget.load(state);
    } catch (e) {
      console.warn("profile: the chart refused the saved state", e);
    }
  }

  function fail(msg) {
    const l = document.getElementById("loading");
    if (l) l.textContent = msg;
    console.error(msg);
  }

  if (typeof qt !== "undefined" && qt.webChannelTransport) {
    new QWebChannel(qt.webChannelTransport, (channel) => {
      const bridge = channel.objects.sc;
      if (bridge) boot(bridge);
      else fail("Chart bridge not found");
    });
  } else {
    fail("Qt WebChannel transport unavailable");
  }
})();
