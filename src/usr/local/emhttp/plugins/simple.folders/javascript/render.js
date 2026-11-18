/* simple.folders - building the table.
 * Copyright (C) 2026  gcarstoiu
 *
 * This program is free software; you can redistribute it and/or modify it
 * under the terms of the GNU General Public License version 2, as published
 * by the Free Software Foundation.
 *
 * Layout follows DESIGN_SPEC.md 3-5. The table is a CSS grid rather than a
 * <table>: a folder row has to hold a wrapping icon strip whose height grows
 * with the number of members, which table layout fights.
 *
 * Every control is a real <button> or <input>. Nothing is a clickable <div>:
 * spec 14 requires full keyboard reach and sensible roles.
 */
(function (root) {
  'use strict';

  var SF = root.SimpleFolders = root.SimpleFolders || {};
  var U = SF.util;
  var R = SF.render = {};

  /* The columns that can be hidden and moved, keyed as in lib/Columns.php.
   * The grip/chevron column and Container always come first, the row menu
   * always last; the store holds which of these show and in what order.
   *
   * "Container Port" and "LAN IP:Port" replace the single vague "Port" this
   * started with - they are what Unraid's own table shows, and keeping all
   * three would have put the same number on screen twice. */
  var COLUMNS = {
    status:    { label: 'Status',         px: 150 },
    version:   { label: 'Version',        px: 150 },
    network:   { label: 'Network',        px: 150 },
    cport:     { label: 'Container Port', px: 112 },
    lan:       { label: 'LAN IP:Port',    px: 150 },
    cpu:       { label: 'CPU',            px: 72 },
    memory:    { label: 'Memory',         px: 92 },
    autostart: { label: 'Autostart',      px: 104 }
  };
  var FIRST = 52, NAME = 260, LAST = 44, GAP = 10, PAD = 24;

  R.columnLabel = function (key) { return COLUMNS[key] ? COLUMNS[key].label : key; };

  /* The shown columns in order, and the grid that lays them out. Below its
   * minimum width the card scrolls sideways (spec 3.1). */
  function layout() {
    var keys = SF.store.columns()
      .filter(function (c) { return c.shown && COLUMNS[c.key]; })
      .map(function (c) { return c.key; });
    var widths = keys.map(function (k) { return COLUMNS[k].px; });
    var count = keys.length + 3;
    return {
      keys: keys,
      grid: [FIRST + 'px', 'minmax(' + NAME + 'px, 1fr)']
        .concat(widths.map(function (w) { return w + 'px'; }), [LAST + 'px']).join(' '),
      min: FIRST + NAME + LAST + widths.reduce(function (a, w) { return a + w; }, 0)
        + GAP * (count - 1) + PAD
    };
  }

  /* A row's cells, in the column order the store holds. */
  function appendCells(row, cells, keys) {
    row.appendChild(cells.tree);
    row.appendChild(cells.name);
    keys.forEach(function (k) { if (cells[k]) row.appendChild(cells[k]); });
    row.appendChild(cells.menu);
  }

  /* ---------------------------------------------------------------------
   * Entry point
   * ------------------------------------------------------------------- */
  R.draw = function (mount) {
    var S = SF.store, state = S.state;

    U.clear(mount);
    mount.hidden = false;

    mount.appendChild(header());

    if (state.error) { mount.appendChild(notice(state.error, 'sf-notice-error')); return; }
    if (!state.loaded) { mount.appendChild(notice('Loading containers…')); return; }

    /* Classic view hands the page back to Unraid's own table untouched. */
    if (state.classic) {
      mount.appendChild(notice('Classic view is on — the standard Unraid table is shown above.'));
      return;
    }

    var folders = S.visibleFolders();
    var loose   = S.visibleLoose();

    if (state.filter && !folders.length && !loose.length) {
      mount.appendChild(notice('Nothing matches “' + state.filter + '”'));
      return;
    }

    var cols = layout();
    var card = U.el('div.sf-card');
    card.style.setProperty('--sf-grid', cols.grid);
    card.style.setProperty('--sf-table-min', cols.min + 'px');
    card.appendChild(columnHeads(cols.keys));

    var body = U.el('div.sf-body');
    folders.forEach(function (entry) {
      body.appendChild(folderRow(entry.folder, cols.keys));
      if (S.isExpanded(entry.folder.id)) {
        entry.members.forEach(function (ct, i) {
          body.appendChild(containerRow(ct, { folder: entry.folder, index: i + 1 }, cols.keys));
        });
      }
    });

    if (loose.length) {
      body.appendChild(sectionLabel('Not in a folder', loose.length));
      loose.forEach(function (ct) { body.appendChild(containerRow(ct, {}, cols.keys)); });
    }

    card.appendChild(body);
    mount.appendChild(card);
    mount.appendChild(actionBar());
  };

  /* Patch only the CPU and memory cells.
   *
   * The dockerload channel republishes roughly once a second. Redrawing the
   * whole table that often discards the card's horizontal scroll offset and
   * any focus in the filter box - on a phone, where the table must be
   * scrolled sideways to read it, that meant it snapped back to the left
   * every second. Nothing else in the row depends on these two numbers, so
   * they are written straight into the existing cells. */
  R.updateLive = function (mount) {
    var S = SF.store;
    if (!mount || S.state.classic || !S.state.loaded) return;

    mount.querySelectorAll('.sf-row-ct[data-container]').forEach(function (row) {
      var ct = S.container(row.dataset.container);
      if (!ct) return;
      setCell(row, '.sf-cell-cpu', U.cpu(S.cpu(ct)));
      setCell(row, '.sf-cell-mem', U.memory(S.mem(ct)));
    });

    mount.querySelectorAll('.sf-row-folder[data-folder]').forEach(function (row) {
      var folder = S.folder(row.dataset.folder);
      if (!folder) return;
      var sum = S.summary(folder);
      setCell(row, '.sf-cell-cpu', U.cpu(sum.cpu));
      setCell(row, '.sf-cell-mem', U.memory(sum.mem));
    });
  };

  function setCell(row, selector, value) {
    var cell = row.querySelector(selector);
    if (cell && cell.textContent !== value) cell.textContent = value;
  }

  /* ---------------------------------------------------------------------
   * Header
   * ------------------------------------------------------------------- */
  function header() {
    var S = SF.store, state = S.state, stats = state.stats;

    /* "16 containers · 13 running · 1 unhealthy · 3 folders · 4 updates
     * ready" - whatever needs attention in amber. */
    var trouble = [
      stats.unhealthy ? stats.unhealthy + ' unhealthy' : null,
      stats.restarting ? stats.restarting + ' restarting' : null
    ].filter(Boolean);
    var summary = [
      U.plural(stats.containers, 'container') + ' · ' + stats.running + ' running',
      trouble.length ? U.el('span.sf-summary-warn', { text: ' · ' + trouble.join(' · ') }) : null,
      ' · ' + [
        U.plural(stats.folders, 'folder'),
        stats.updates ? U.plural(stats.updates, 'update') + ' ready' : null
      ].filter(Boolean).join(' · ')
    ];

    var filter = U.el('input.sf-filter-input', {
      type: 'search',
      value: state.filter,
      placeholder: 'Filter containers or folders',
      'aria-label': 'Filter containers or folders',
      onInput: U.debounce(function (e) { S.setFilter(e.target.value.trim()); }, 140)
    });

    var open = S.anyExpanded();

    var actions = U.el('div.sf-head-actions', null, [
      U.el('div.sf-filter', null, [U.glyph('search', 'sf-filter-icon'), filter]),

      U.el('button.sf-btn.sf-btn-cols', {
        type: 'button',
        disabled: state.classic,
        'aria-haspopup': 'dialog',
        'aria-expanded': String(!!(SF.menus && SF.menus.isOpen('columns'))),
        onClick: function (e) { SF.menus.columns(e.currentTarget); }
      }, [U.glyph('columns'), U.el('span', { text: 'Columns' })]),

      U.el('button.sf-btn', {
        type: 'button',
        disabled: state.classic || !state.folders.length,
        onClick: function () { S.setAllExpanded(!open); }
      }, open ? 'Fold all' : 'Unfold all'),

      U.el('button.sf-btn.sf-btn-primary', {
        type: 'button',
        disabled: state.classic,
        onClick: function () { SF.editor.open(null); }
      }, '+ New folder'),

      classicToggle()
    ]);

    /* No eyebrow and no "Containers" heading: Unraid already prints its own
     * "Docker Containers" heading directly above this, and repeating it put
     * three stacked titles on the page. The summary line carries straight on
     * from Unraid's heading. */
    return U.el('header.sf-head', null, [
      U.el('div.sf-head-text', null, [
        U.el('div.sf-summary', null, summary)
      ]),
      actions
    ]);
  }

  /* The safety valve: hide our table and show Unraid's, with no reload. */
  function classicToggle() {
    var S = SF.store, on = S.state.classic;
    return U.el('label.sf-classic', { title: 'Show the standard Unraid container table instead' }, [
      U.el('input', {
        type: 'checkbox',
        checked: on,
        onChange: function (e) { S.setClassic(e.target.checked); }
      }),
      U.el('span', { text: 'Classic view' })
    ]);
  }

  function columnHeads(keys) {
    var row = U.el('div.sf-row.sf-row-head', { role: 'row' });
    var labels = [''].concat(['Container'], keys.map(R.columnLabel), ['']);
    labels.forEach(function (label) {
      row.appendChild(U.el('div.sf-cell', {
        role: 'columnheader',
        'aria-hidden': label ? null : 'true',
        text: label
      }));
    });
    return row;
  }

  function sectionLabel(text, count) {
    return U.el('div.sf-section', null, [
      U.el('span.sf-section-text', { text: text }),
      U.el('span.sf-section-count', { text: '· ' + count })
    ]);
  }

  function notice(text, cls) {
    return U.el('div.sf-notice' + (cls ? '.' + cls : ''), { text: text });
  }


  /* ---------------------------------------------------------------------
   * Global action bar
   *
   * The eight actions from Unraid's classic Docker view, which our table
   * otherwise hides along with the native button row.
   *
   * The four lifecycle actions are one joined segmented control under an
   * "All containers" label. That label is not decoration: the buttons say
   * "Stop", not "Stop All", and without it a bar sitting under a table of
   * folders reads as if it acts on a folder. Stop and Pause also confirm
   * first, because they hit every container on the server.
   * ------------------------------------------------------------------- */
  function actionBar() {
    var S = SF.store;
    var busy = SF.jobs.running();
    var cts = S.state.containers;

    var running = cts.filter(function (c) { return c.state === 'running'; }).length;
    var paused  = cts.filter(function (c) { return c.state === 'paused'; }).length;
    var stopped = cts.filter(function (c) { return c.state === 'stopped'; }).length;
    var updates = cts.filter(function (c) { return c.update === 1; }).length;

    var segs = U.el('div.sf-seggroup', { role: 'group', 'aria-label': 'All containers' }, [
      seg('play',   'Start',  'Start every stopped container', busy || !stopped,
          function () { SF.actions.globalLifecycle('start'); }),
      seg('stop',   'Stop',   'Stop every running container',  busy || !(running + paused),
          function () { SF.actions.globalLifecycle('stop'); }),
      seg('pause',  'Pause',  'Pause every running container', busy || !running,
          function () { SF.actions.globalLifecycle('pause'); }),
      seg('resume', 'Resume', 'Resume every paused container', busy || !paused,
          function () { SF.actions.globalLifecycle('resume'); })
    ]);

    var row = U.el('div.sf-actions', null, [
      chip('plus', 'Add container', 'brand', false, function () { SF.actions.addContainer(); }),
      segs,
      U.el('span.sf-act-grow'),
      chip('check', 'Check', null, busy, function () { SF.actions.checkUpdates(null); }),
      updates
        ? chip('download', 'Update ' + updates, 'warn', busy,
               function () { SF.actions.globalUpdate(); })
        : chip('download', 'Update', null, true, function () {}),
      U.el('button.sf-act', {
        type: 'button',
        'aria-label': 'More actions',
        'aria-haspopup': 'menu',
        onClick: function (e) { SF.menus.globalMore(e.currentTarget); }
      }, [U.glyph('more')])
    ]);

    return U.el('div.sf-actionbar', null, [
      U.el('div.sf-grouplbl', { text: 'All containers' }),
      row
    ]);
  }

  function chip(icon, label, tone, disabled, onClick) {
    return U.el('button.sf-chip' + (tone ? '.sf-chip-' + tone : ''), {
      type: 'button',
      disabled: disabled || false,
      onClick: onClick
    }, [U.glyph(icon), U.el('span', { text: label })]);
  }

  function seg(icon, label, title, disabled, onClick) {
    return U.el('button.sf-seg', {
      type: 'button',
      title: title,
      'aria-label': title,
      disabled: disabled || false,
      onClick: onClick
    }, [U.glyph(icon), U.el('span', { text: label })]);
  }

  /* ---------------------------------------------------------------------
   * Folder row (spec 4)
   * ------------------------------------------------------------------- */
  function folderRow(folder, keys) {
    var S = SF.store;
    var sum = S.summary(folder);
    var open = S.isExpanded(folder.id);

    var row = U.el('div.sf-row.sf-row-folder', {
      role: 'row',
      'data-folder': folder.id,
      'data-color': folder.color
    });
    if (SF.dnd) SF.dnd.attach(row, 'folder', folder.id);
    var cells = {};

    /* 1 - chevron */
    var chevron = U.el('button.sf-chevron', {
      type: 'button',
      'aria-expanded': String(open),
      'aria-label': (open ? 'Collapse' : 'Expand') + ' folder ' + folder.name,
      disabled: !!S.state.filter,
      onClick: function () { S.toggle(folder.id); }
    }, [U.el('span.sf-chevron-mark', { 'aria-hidden': 'true' })]);
    /* Grip first, then the chevron in a fixed slot, so the grip lines up
     * across every row and both keep a full hit area of their own. */
    cells.tree = U.el('div.sf-cell.sf-cell-tree', null, [
      grip('folder', folder.id, 'Drag to reorder folder ' + folder.name),
      U.el('div.sf-tree-slot', null, [chevron])
    ]);

    /* 2 - icon, name, count, and either the icon strip or the sub-line */
    var icon = U.el('button.sf-folder-icon', {
      type: 'button',
      'aria-label': 'Commands for folder ' + folder.name,
      'aria-haspopup': 'dialog',
      onClick: function (e) { SF.menus.folder(e.currentTarget, folder, 'left'); }
    }, [folderIconContent(folder)]);

    /* Clicking the name folds the folder too - mouse convenience, not a second
     * tab stop (spec 4.3), so tabindex="-1". It must NOT be aria-hidden:
     * that would take the folder's name out of the accessibility tree and
     * leave a screen reader with an unnamed row. */
    var nameButton = U.el('button.sf-folder-name', {
      type: 'button',
      tabindex: '-1',
      onClick: function () { if (!S.state.filter) S.toggle(folder.id); }
    }, folder.name);

    /* The count sits beside the name only when the folder is folded; when it
     * is open the sub-line below already carries it, and showing both reads
     * as a mistake. */
    var line1 = U.el('div.sf-folder-line1', null, [
      nameButton,
      open ? null : U.el('span.sf-folder-count', { text: U.plural(sum.total, 'container') })
    ]);

    var line2 = (!open && folder.preview !== 'count')
      ? iconStrip(folder, sum.members)
      : U.el('div.sf-folder-sub', { text: subLine(folder, sum) });

    cells.name = U.el('div.sf-cell.sf-cell-name', null, [
      icon,
      U.el('div.sf-folder-text', null, [line1, line2])
    ]);

    /* status: the count, a bar, and in amber whatever needs attention - a
     * folded folder would otherwise hide an unhealthy member entirely. */
    var trouble = [
      sum.unhealthy ? sum.unhealthy + ' unhealthy' : null,
      sum.restarting ? sum.restarting + ' restarting' : null
    ].filter(Boolean);
    cells.status = U.el('div.sf-cell', null, [
      U.el('div.sf-folder-status' + (sum.busy ? '.is-busy' : (sum.allRunning && !trouble.length ? '.is-all' : '')), {
        text: sum.busy
          ? 'Working… ' + sum.running + ' of ' + sum.total + ' up'
          : sum.running + ' of ' + sum.total + ' running'
      }),
      segmentBar(sum.members),
      trouble.length && !sum.busy ? U.el('div.sf-folder-alert', { text: trouble.join(' · ') }) : null
    ]);

    cells.version = U.el('div.sf-cell', null, [
      sum.updates
        ? U.el('span.sf-badge.sf-badge-warn', { text: U.plural(sum.updates, 'update') })
        : U.el('span.sf-muted', { text: 'Up to date' })
    ]);

    /* A folder has no network or address of its own. CPU and memory are
     * sums, which R.updateLive() patches in place. */
    cells.network = U.el('div.sf-cell.sf-mono.sf-muted', { text: '—' });
    cells.cport   = U.el('div.sf-cell.sf-mono.sf-muted', { text: '—' });
    cells.lan     = U.el('div.sf-cell.sf-mono.sf-muted', { text: '—' });
    cells.cpu     = U.el('div.sf-cell.sf-mono.sf-cell-cpu', { text: U.cpu(sum.cpu) });
    cells.memory  = U.el('div.sf-cell.sf-mono.sf-cell-mem', { text: U.memory(sum.mem) });

    /* tri-state autostart */
    cells.autostart = U.el('div.sf-cell', null, [
      switchControl({
        state: sum.autostart,
        label: { on: 'All on', off: 'All off', mixed: 'Mixed' }[sum.autostart],
        ariaLabel: 'Autostart for every container in ' + folder.name,
        onToggle: function () { SF.actions.setFolderAutostart(folder, sum.autostart !== 'on'); }
      })
    ]);

    /* overflow menu */
    cells.menu = U.el('div.sf-cell.sf-cell-menu', null, [
      kebab('Menu for folder ' + folder.name, function (e) {
        SF.menus.folder(e.currentTarget, folder, 'right');
      }, 'dialog')
    ]);

    appendCells(row, cells, keys);
    return row;
  }

  /* "5 containers - starts 5 s apart"; the delay half is dropped at 0. */
  function subLine(folder, sum) {
    var text = U.plural(sum.total, 'container');
    if (folder.delay > 0) text += ' · starts ' + folder.delay + ' s apart';
    return text;
  }

  /* The folded folder's icon strip: EVERY member, no cap and no "+N"
   * (spec 4.1). It sits on its own line under the name and wraps, so a narrow
   * Container column grows the row instead of colliding with the next one. */
  function iconStrip(folder, members) {
    var strip = U.el('div.sf-strip', { role: 'group', 'aria-label': 'Containers in ' + folder.name });

    members.forEach(function (ct) {
      var status = SF.store.status(ct);
      var button = U.el('button.sf-strip-btn', {
        type: 'button',
        'aria-label': 'Actions for ' + ct.name + ', ' + status.label,
        'aria-haspopup': 'dialog',
        title: ct.name + ' · ' + status.label,
        onClick: function (e) { SF.menus.container(e.currentTarget, ct, 'left'); }
      }, [containerTile(ct, 'sf-strip-tile')]);

      /* "Icons only" hides the status dot but keeps the tooltip and label. */
      if (folder.preview !== 'icons') {
        button.appendChild(U.el('span.sf-strip-dot.sf-dot-' + status.kind, { 'aria-hidden': 'true' }));
      }
      strip.appendChild(button);
    });

    return strip;
  }

  /* One segment per member, coloured by status (spec 4.4). */
  function segmentBar(members) {
    var bar = U.el('div.sf-segments', { 'aria-hidden': 'true' });
    members.forEach(function (ct) {
      bar.appendChild(U.el('span.sf-segment.sf-seg-' + SF.store.status(ct).kind));
    });
    return bar;
  }

  /* ---------------------------------------------------------------------
   * Container row (spec 5)
   * ------------------------------------------------------------------- */
  function containerRow(ct, opts, keys) {
    var S = SF.store;
    var status = S.status(ct);
    var inFolder = !!opts.folder;

    var row = U.el('div.sf-row.sf-row-ct' + (inFolder ? '.is-nested' : ''), {
      role: 'row',
      'data-container': ct.name
    });
    if (SF.dnd) SF.dnd.attach(row, 'container', ct.name);
    var cells = {};

    /* the grip, then the tree line in the same slot the chevron uses on a
     * folder row, so the indent reads straight down the column. */
    cells.tree = U.el('div.sf-cell.sf-cell-tree', null, [
      grip('container', ct.name, 'Drag to move or reorder ' + ct.name),
      U.el('div.sf-tree-slot', null, [
        inFolder ? U.el('span.sf-tree', { 'aria-hidden': 'true' }) : null
      ])
    ]);

    /* start-order number, icon, name with its Compose stack, image */
    var iconButton = U.el('button.sf-ct-icon', {
      type: 'button',
      'aria-label': 'Actions for ' + ct.name + ', ' + status.label,
      'aria-haspopup': 'dialog',
      onClick: function (e) { SF.menus.container(e.currentTarget, ct, 'left'); }
    }, [containerTile(ct, 'sf-ct-tile')]);

    cells.name = U.el('div.sf-cell.sf-cell-name', null, [
      inFolder ? U.el('span.sf-order.sf-mono', { text: String(opts.index), 'aria-hidden': 'true' }) : null,
      iconButton,
      U.el('div.sf-ct-text', null, [
        U.el('div.sf-ct-line1', null, [
          U.el('div.sf-ct-name', { text: ct.name }),
          ct.stack ? U.el('span.sf-stack', { title: 'Compose stack: ' + ct.stack }, [
            U.glyph('stack'), U.el('span', { text: ct.stack })
          ]) : null
        ]),
        U.el('div.sf-ct-image', { text: ct.image })
      ])
    ]);

    /* status: the marker's SHAPE differs per state, so colour is never the
     * only signal (spec 5, spec 14). Under it, Docker's own account: uptime
     * and health, or how it last exited. */
    var detail = S.statusDetail(ct);
    cells.status = U.el('div.sf-cell', null, [
      U.el('div.sf-ct-status', null, [
        U.el('span.sf-dot.sf-dot-' + status.kind, { 'aria-hidden': 'true' }),
        U.el('span.sf-status-text.sf-status-' + status.kind, { text: status.label })
      ]),
      detail ? U.el('div.sf-sub' + (detail.warn ? '.sf-sub-warn' : ''), {
        text: detail.text,
        title: ct.statusText ? 'Docker: ' + ct.statusText : null
      }) : null
    ]);

    /* version: the image's own version label, when it has one */
    cells.version = U.el('div.sf-cell', null, [
      ct.version ? U.el('div.sf-version', { text: ct.version, title: ct.version }) : null,
      ct.update === 1 ? U.el('span.sf-badge.sf-badge-warn', { text: 'Update ready' })
      : ct.update === 2 ? U.el('span.sf-badge.sf-badge-warn', { text: 'Rebuild ready' })
      : U.el('span.sf-muted', { text: 'Up to date' })
    ]);

    cells.network = networkCell(ct);
    cells.cport = portCell(ct.ports && ct.ports.internal);
    cells.lan = portCell(ct.ports && ct.ports.external);
    cells.cpu = U.el('div.sf-cell.sf-mono.sf-cell-cpu', { text: U.cpu(S.cpu(ct)) });
    cells.memory = U.el('div.sf-cell.sf-mono.sf-cell-mem', { text: U.memory(S.mem(ct)) });

    /* autostart, with the delay before the next container starts */
    var wait = ct.autostart && ct.wait > 0 ? ct.wait : 0;
    cells.autostart = U.el('div.sf-cell', null, [
      switchControl({
        state: ct.autostart ? 'on' : 'off',
        label: ct.autostart ? 'On' : 'Off',
        extra: wait ? ' · ' + wait + ' s' : '',
        title: wait ? 'Waits ' + wait + ' s before the next container starts' : null,
        ariaLabel: 'Autostart ' + ct.name,
        onToggle: function () { SF.actions.setContainerAutostart(ct, !ct.autostart); }
      })
    ]);

    cells.menu = U.el('div.sf-cell.sf-cell-menu', null, [
      kebab('Menu for ' + ct.name, function (e) { SF.menus.container(e.currentTarget, ct, 'right'); }, 'dialog')
    ]);

    appendCells(row, cells, keys);
    return row;
  }

  /* The container's main network and its address on it. A container that
   * uses another one's network has neither; it names that container. */
  function networkCell(ct) {
    if (ct.via) {
      return U.el('div.sf-cell', null, [
        U.el('div.sf-net-name', { text: 'via ' + ct.via, title: 'Uses the network of ' + ct.via }),
        U.el('div.sf-net-ip.is-text', { text: 'shares its network' })
      ]);
    }
    var nets = ct.networks || [];
    if (!ct.network) return U.el('div.sf-cell.sf-mono.sf-muted', { text: '—' });

    var up = ct.state === 'running' || ct.state === 'paused';
    var ip = up && nets[0] ? nets[0].ip : '';
    var more = nets.length > 1 ? ' +' + (nets.length - 1) : '';
    return U.el('div.sf-cell', {
      title: nets.map(function (n) { return n.name + (n.ip ? '  ' + n.ip : ''); }).join('\n') || null
    }, [
      U.el('div.sf-net-name', { text: ct.network + more }),
      ip ? U.el('div.sf-net-ip', { text: ip })
         : U.el('div.sf-net-ip.is-text', { text: up ? '—' : 'not running' })
    ]);
  }

  /* ---------------------------------------------------------------------
   * Shared pieces
   * ------------------------------------------------------------------- */

  /* A container's own icon, as Unraid resolved it. The harness (and any
   * container without one) falls back to a letter on a tinted tile, which is
   * what the prototype shows - the plugin never ships third-party logos. */
  R.containerTile = function (ct, cls) { return containerTile(ct, cls); };
  R.folderIcon = function (folder) { return folderIconContent(folder); };

  function containerTile(ct, cls) {
    if (ct.icon) {
      return U.el('img', {
        class: cls + ' sf-tile-img',
        src: ct.icon,
        alt: '',
        loading: 'lazy',
        /* Without this the browser starts its own image drag, which looks
         * exactly like ours and does nothing on drop. */
        draggable: 'false',
        /* A broken icon URL must not leave an empty hole in the row. */
        onError: function (e) {
          var fallback = letterTile(ct, cls);
          if (e.target.parentNode) e.target.parentNode.replaceChild(fallback, e.target);
        }
      });
    }
    return letterTile(ct, cls);
  }

  function letterTile(ct, cls) {
    return U.el('span.' + cls.replace(/^\./, '') + '.sf-tile-letter', {
      'data-tint': ct.tint || 'slate',
      'aria-hidden': 'true',
      text: (ct.letter || ct.name.charAt(0)).toUpperCase()
    });
  }

  function folderIconContent(folder) {
    var icon = folder.icon || {};

    if (icon.type === 'web' && icon.localFile) {
      return U.el('img.sf-folder-img', {
        src: SF.config.base + '/include/Icons.php?file=' + encodeURIComponent(icon.localFile),
        alt: '', loading: 'lazy', draggable: 'false'
      });
    }

    if (icon.type === 'container') {
      var ct = SF.store.container(icon.name);
      if (ct) return containerTile(ct, 'sf-folder-img');
    }

    return U.glyph(icon.key || 'folder', 'sf-folder-glyph');
  }

  /* Two-state and tri-state switch. aria-pressed carries "mixed" for the
   * folder switch, which is exactly what that value is for. */
  function switchControl(opts) {
    var track = U.el('button.sf-switch', {
      type: 'button',
      'data-state': opts.state,
      'aria-pressed': opts.state === 'mixed' ? 'mixed' : String(opts.state === 'on'),
      'aria-label': opts.ariaLabel,
      onClick: opts.onToggle
    }, [U.el('span.sf-switch-knob', { 'aria-hidden': 'true' })]);

    return U.el('div.sf-switch-wrap', { title: opts.title || null }, [
      track,
      U.el('span.sf-switch-label', null, [
        opts.label,
        opts.extra ? U.el('span.sf-wait', { text: opts.extra }) : null
      ])
    ]);
  }

  /* A port column. A container can publish several, so they stack; the cell
   * stays on one line per entry rather than wrapping mid-address. */
  function portCell(list) {
    var values = (list || []).filter(Boolean);
    if (!values.length) return U.el('div.sf-cell.sf-mono.sf-muted', { text: '—' });

    var cell = U.el('div.sf-cell.sf-mono.sf-ports', { title: values.join('\n') });
    values.forEach(function (v) { cell.appendChild(U.el('span.sf-port', { text: v })); });
    return cell;
  }

  /* The drag handle. A real button so it is focusable and announced, but it
   * does nothing on click: dragging has no keyboard equivalent, and the same
   * moves are all available from the menus, which is the route that works
   * without a pointer. */
  function grip(kind, key, label) {
    var node = U.el('button.sf-grip', {
      type: 'button',
      tabindex: '-1',
      'aria-hidden': 'true',
      title: label,
      /* Stop the browser's own text/image dragging from interfering. */
      draggable: 'false',
      onClick: function (e) { e.preventDefault(); }
    }, [U.el('span.sf-grip-dots', { 'aria-hidden': 'true' })]);

    return node;
  }

  /* The folder and container popovers are dialogs with groups, not menus
   * (spec 6). */
  function kebab(label, onClick, popup) {
    return U.el('button.sf-kebab', {
      type: 'button',
      'aria-label': label,
      'aria-haspopup': popup || 'menu',
      onClick: onClick
    }, [U.el('span', { 'aria-hidden': 'true', text: '⋮' })]);
  }
})(window);
