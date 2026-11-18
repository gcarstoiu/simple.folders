/* simple.folders - popover menus.
 * Copyright (C) 2026  gcarstoiu
 *
 * This program is free software; you can redistribute it and/or modify it
 * under the terms of the GNU General Public License version 2, as published
 * by the Free Software Foundation.
 *
 * One popover shell serves the menu and the folder and container popovers
 * (DESIGN_SPEC.md 6): max-height 76vh with scroll, opens below the trigger or
 * above when there is no room, closes on outside click, on Escape with focus
 * returning to the trigger, and after choosing an item.
 *
 * While any job is running every Docker action is disabled (spec 6).
 */
(function (root) {
  'use strict';

  var SF = root.SimpleFolders = root.SimpleFolders || {};
  var U = SF.util;
  var M = SF.menus = {};

  var open = null;   // { node, trigger }

  /* ---------------------------------------------------------------------
   * The popover shell
   * ------------------------------------------------------------------- */
  function mount(trigger, align, node, onKey, kind) {
    M.close();
    U.layer().appendChild(node);
    position(node, trigger, align);

    open = { node: node, trigger: trigger, kind: kind || '' };

    /* Deferred so the click that opened it does not immediately close it on
     * the way back up. */
    setTimeout(function () { document.addEventListener('mousedown', onOutside, true); }, 0);

    node.addEventListener('keydown', onKey);
  }

  function show(trigger, align, title, items) {
    var list = U.el('div.sf-menu', { role: 'menu', 'aria-label': title });
    list.appendChild(U.el('div.sf-menu-head', { text: title }));

    items.forEach(function (item) {
      if (!item) return;
      if (item.divider) { list.appendChild(U.el('div.sf-menu-divider', { role: 'separator' })); return; }

      /* A group label such as "Move to folder" - not focusable, not an item. */
      if (item.heading) {
        list.appendChild(U.el('div.sf-menu-sub', { role: 'presentation', text: item.text }));
        return;
      }

      var cls = '.sf-menu-item' + (item.tone ? '.sf-menu-' + item.tone : '');
      var button = U.el('button' + cls, {
        type: 'button',
        role: 'menuitem',
        disabled: item.disabled || false,
        onClick: function () { M.close(); item.action(); }
      }, [
        U.el('span.sf-menu-label', { text: item.text }),
        item.hint ? U.el('span.sf-menu-hint', { text: item.hint }) : null
      ]);
      list.appendChild(button);
    });

    mount(trigger, align, list, onMenuKey);

    var first = list.querySelector('.sf-menu-item:not([disabled])');
    if (first) first.focus();
    return list;
  }

  function position(node, trigger, align) {
    var rect = trigger.getBoundingClientRect();
    var height = node.offsetHeight;
    var width = node.offsetWidth;
    var gap = 6;

    var below = rect.bottom + gap;
    var fitsBelow = below + height <= root.innerHeight - 8;
    var top = fitsBelow ? below : Math.max(8, rect.top - gap - height);

    var left = align === 'right' ? rect.right - width : rect.left;
    left = Math.min(Math.max(8, left), root.innerWidth - width - 8);

    node.style.top = (top + root.scrollY) + 'px';
    node.style.left = (left + root.scrollX) + 'px';
  }

  function onOutside(e) {
    if (!open || open.node.contains(e.target)) return;
    /* The Columns button toggles its list itself; closing here first would
     * only have the click open it again. */
    if (open.kind === 'columns' && e.target.closest && e.target.closest('.sf-btn-cols')) return;
    M.close();
  }

  /* Arrow keys move between items; Tab leaves and closes, which is what a
   * menu should do rather than trapping focus. */
  function onMenuKey(e) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();

    var items = Array.prototype.slice.call(this.querySelectorAll('.sf-menu-item:not([disabled])'));
    if (!items.length) return;

    var i = items.indexOf(document.activeElement);
    var next = e.key === 'ArrowDown'
      ? (i + 1) % items.length
      : (i <= 0 ? items.length - 1 : i - 1);
    items[next].focus();
  }

  M.close = function () {
    if (!open) return false;
    document.removeEventListener('mousedown', onOutside, true);

    var trigger = open.trigger;
    var kind = open.kind;
    if (open.node.parentNode) open.node.parentNode.removeChild(open.node);
    open = null;

    /* The table is redrawn while the Columns list is open, which replaces
     * the button that opened it; go back to the one on the page now. */
    if (kind === 'columns') {
      trigger = document.querySelector('#sf-root .sf-btn-cols') || trigger;
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
    }

    /* Focus goes back where it came from (spec 6). */
    if (trigger && document.contains(trigger)) trigger.focus();
    return true;
  };

  M.isOpen = function (kind) { return !!open && (!kind || open.kind === kind); };

  /* ---------------------------------------------------------------------
   * Shared popover parts
   * ------------------------------------------------------------------- */

  /* Every control closes the popover before it acts, so focus is back on
   * the trigger when a dialog or another page takes over. */
  function act(fn) { return function () { M.close(); fn(); }; }

  function listRow(glyph, text, off, fn) {
    return U.el('button.sf-menu-item', { type: 'button', disabled: off, onClick: act(fn) }, [
      U.glyph(glyph, 'sf-ctm-ico'),
      U.el('span.sf-menu-label', { text: text })
    ]);
  }

  function busyNote() {
    return U.el('div.sf-ctm-busy', { role: 'note' }, [
      U.el('span.sf-mark.sf-mark-active', { 'aria-hidden': 'true' }),
      U.el('span', { text: (SF.jobs.title() || 'A job is running') + '. Docker actions are off until it finishes.' })
    ]);
  }

  function ordinal(n) {
    var s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  /* ---------------------------------------------------------------------
   * Folder popover (spec 6.1)
   *
   * Built from the container popover's parts: a header with a state pill,
   * a banner only when updates are ready, the four bulk actions in fixed
   * slots, the folder's own rows, and the two risky actions in a footer.
   * WebUIs are chips that open one tab each: browsers block every tab after
   * the first that a single click tries to open.
   * ------------------------------------------------------------------- */
  M.folder = function (trigger, folder, align) {
    var S = SF.store;
    var A = SF.actions;
    var sum = S.summary(folder);
    var busy = SF.jobs.running();
    var folders = S.state.folders;
    var index = folders.indexOf(S.folder(folder.id));
    var empty = sum.total === 0;
    var up = sum.running + sum.paused;

    var pop = U.el('div.sf-menu.sf-fm', { role: 'dialog', 'aria-label': 'Commands for folder ' + folder.name });

    var segments = U.el('span.sf-fm-segs', { 'aria-hidden': 'true' });
    sum.members.forEach(function (ct) {
      segments.appendChild(U.el('span.sf-fm-seg.sf-seg-' + S.status(ct).kind));
    });
    pop.appendChild(U.el('div.sf-ctm-head', null, [
      U.el('span.sf-fm-tile', { 'data-color': folder.color || 'slate', 'aria-hidden': 'true' },
        [SF.render.folderIcon(folder)]),
      U.el('div.sf-ctm-title', null, [
        U.el('div.sf-ctm-name', { text: folder.name }),
        U.el('div.sf-ctm-image', { text: folder.delay ? folder.delay + ' s apart' : 'no delay' })
      ]),
      U.el('span.sf-ctm-state', { title: sum.running + ' of ' + sum.total + ' running' },
        [segments, sum.running + ' running'])
    ]));

    if (busy) pop.appendChild(busyNote());

    if (sum.updates) {
      pop.appendChild(U.el('div.sf-ctm-update', { 'data-sf-group': '' }, [
        U.glyph('download', 'sf-ctm-ico'),
        U.el('span.sf-ctm-update-text', { text: U.plural(sum.updates, 'update') + ' ready' }),
        U.el('button.sf-ctm-go', {
          type: 'button',
          disabled: busy,
          onClick: act(function () { A.update(folder, false); })
        }, 'Update')
      ]));
    }

    /* Fixed slots, each with the number it acts on. Pause and Resume share
     * the last: whichever applies to the folder's current state. */
    var slots = [
      { glyph: 'play', text: 'Start all', run: 'start', off: !sum.stopped,
        count: sum.stopped ? sum.stopped + ' stopped' : 'all up' },
      { glyph: 'stop', text: 'Stop all', run: 'stop', off: !up,
        count: up ? up + ' up' : 'none up' },
      { glyph: 'restart', text: 'Restart all', run: 'restart', off: !sum.running,
        count: sum.running + ' running' },
      sum.paused
        ? { glyph: 'resume', text: 'Resume all', run: 'resume', off: false,
            count: sum.paused + ' paused' }
        : { glyph: 'pause', text: 'Pause all', run: 'pause', off: !sum.running,
            count: sum.running + ' running' }
    ];
    var strip = U.el('div.sf-ctm-strip', { role: 'toolbar', 'aria-label': 'Run ' + folder.name, 'data-sf-group': '' });
    slots.forEach(function (slot) {
      strip.appendChild(U.el('button.sf-ctm-act.sf-fm-act', {
        type: 'button',
        'aria-label': slot.text + ', ' + slot.count,
        disabled: busy || slot.off,
        onClick: act(function () { A.bulk(folder, slot.run); })
      }, [
        U.glyph(slot.glyph, 'sf-ctm-ico'),
        U.el('span.sf-fm-act-label', { text: slot.text }),
        U.el('span.sf-fm-count', { text: slot.count })
      ]));
    });
    pop.appendChild(strip);

    pop.appendChild(U.el('div.sf-ctm-list', { 'data-sf-group': '' }, [
      listRow('search', 'Check for updates', busy || empty, function () { A.checkUpdates(folder); }),
      listRow('edit', 'Edit folder…', false, function () { SF.editor.open(folder); })
    ]));

    pop.appendChild(U.el('div.sf-fm-pos', { role: 'group', 'aria-label': 'Folder position', 'data-sf-group': '' }, [
      U.glyph('order', 'sf-ctm-ico'),
      U.el('span.sf-fm-pos-label', { text: 'Position' }),
      U.el('span.sf-fm-pos-value', { text: ordinal(index + 1) + ' of ' + folders.length }),
      U.el('button.sf-fm-move', {
        type: 'button',
        'aria-label': 'Move ' + folder.name + ' up',
        title: 'Move up',
        disabled: index <= 0,
        onClick: act(function () { A.moveFolder(folder, 'up'); })
      }, [U.glyph('up', 'sf-ctm-ico')]),
      U.el('button.sf-fm-move', {
        type: 'button',
        'aria-label': 'Move ' + folder.name + ' down',
        title: 'Move down',
        disabled: index < 0 || index >= folders.length - 1,
        onClick: act(function () { A.moveFolder(folder, 'down'); })
      }, [U.glyph('down', 'sf-ctm-ico')])
    ]));

    /* One chip per container with a WebUI; only a running one opens. */
    var withUi = sum.members.filter(function (ct) { return !!ct.webui; });
    var web = U.el('div.sf-fm-web', null, [
      U.el('div.sf-fm-web-head', null, [
        U.el('span.sf-menu-sub', { text: 'WebUI' }),
        withUi.length ? U.el('span.sf-menu-hint', { text: 'one tab per tap' }) : null
      ])
    ]);
    if (withUi.length) {
      var chips = U.el('div.sf-ctm-chips', { role: 'group', 'aria-label': 'WebUIs in ' + folder.name, 'data-sf-group': '' });
      withUi.forEach(function (ct) {
        var on = ct.state === 'running';
        chips.appendChild(U.el('button.sf-ctm-chip.sf-fm-web-chip', {
          type: 'button',
          disabled: !on,
          title: on ? ct.webui : S.status(ct).label,
          onClick: act(function () { root.open(ct.webui, '_blank', 'noopener'); })
        }, [
          SF.render.containerTile(ct, 'sf-fm-ctile'),
          U.el('span.sf-ctm-chip-name', { text: ct.name }),
          U.glyph('webui', 'sf-fm-ext')
        ]));
      });
      web.appendChild(chips);
    } else {
      web.appendChild(U.el('div.sf-fm-empty', { text: 'No container in ' + folder.name + ' has a WebUI' }));
    }
    pop.appendChild(web);

    /* Both ask first. */
    pop.appendChild(U.el('div.sf-ctm-foot', { 'data-sf-group': '' }, [
      U.el('button.sf-ctm-risk.sf-ctm-warn', {
        type: 'button',
        disabled: busy || empty,
        onClick: act(function () { A.confirmForceUpdate(folder); })
      }, [U.glyph('force', 'sf-ctm-ico'), 'Force update all…']),
      U.el('button.sf-ctm-risk.sf-ctm-danger', {
        type: 'button',
        disabled: busy,
        onClick: act(function () { A.confirmDelete(folder); })
      }, [U.glyph('remove', 'sf-ctm-ico'), 'Delete folder…'])
    ]));

    mount(trigger, align, pop, onPopoverKey);

    var groups = popoverGroups(pop);
    if (groups.length) entryOf(groups[0]).focus();
    return pop;
  };

  /* ---------------------------------------------------------------------
   * The action bar's overflow
   *
   * Container Size is the one classic action with no place in the bar: it is
   * rarely used and opens a view of its own. It lives here rather than being
   * dropped, so nothing from the classic row is lost.
   * ------------------------------------------------------------------- */
  M.globalMore = function (trigger) {
    return show(trigger, 'right', 'All containers', [
      { text: 'Container size\u2026',
        hint: 'disk usage',
        action: function () { SF.actions.containerSize(); } },
      { divider: true },
      { text: 'Classic view',
        hint: SF.store.state.classic ? 'on' : 'off',
        action: function () { SF.store.setClassic(!SF.store.state.classic); } }
    ]);
  };

  /* ---------------------------------------------------------------------
   * Container popover (spec 6.2)
   *
   * Reachable from the row's icon and kebab AND from a folded folder's icon
   * strip. Not a menu: the four everyday actions sit in a strip whose slots
   * never move, an update gets a banner only when one is ready, the folder is
   * a row of chips and the two risky actions share a footer. Each group is
   * one Tab stop; the arrow keys move within a group.
   * ------------------------------------------------------------------- */
  M.container = function (trigger, ct, align) {
    var S = SF.store;
    var A = SF.actions;
    var busy = SF.jobs.running();
    var folder = S.folderOf(ct.name);
    var status = S.status(ct);
    var running = ct.state === 'running';
    var paused  = ct.state === 'paused';
    var name = ct.name;

    var pop = U.el('div.sf-menu.sf-ctm', { role: 'dialog', 'aria-label': 'Actions for ' + name });

    pop.appendChild(U.el('div.sf-ctm-head', null, [
      SF.render.containerTile(ct, 'sf-ctm-tile'),
      U.el('div.sf-ctm-title', null, [
        U.el('div.sf-ctm-name', { text: name }),
        U.el('div.sf-ctm-image', { text: ct.image })
      ]),
      U.el('span.sf-ctm-state', null, [
        U.el('span.sf-dot.sf-dot-' + status.kind, { 'aria-hidden': 'true' }),
        status.label
      ])
    ]));

    if (busy) pop.appendChild(busyNote());

    /* 2 is "rebuild ready": the network it was built on is gone. Recreating
     * it is the same update_container run as an update. */
    if (ct.update === 1 || ct.update === 2) {
      var rebuild = ct.update === 2;
      pop.appendChild(U.el('div.sf-ctm-update', { 'data-sf-group': '' }, [
        U.glyph('download', 'sf-ctm-ico'),
        U.el('span.sf-ctm-update-text', { text: rebuild ? 'Rebuild ready' : 'Update ready' }),
        U.el('button.sf-ctm-go', {
          type: 'button',
          disabled: busy,
          onClick: act(function () { A.updateContainers([ct], name); })
        }, rebuild ? 'Rebuild' : 'Update')
      ]));
    }

    /* Fixed slots: Start/Stop, Restart, Pause/Resume, WebUI. What cannot run
     * is greyed out rather than removed. A paused container can be stopped,
     * as the folder's Stop all already does. */
    var slots = [
      running || paused ? { glyph: 'stop', text: 'Stop', run: 'stop' }
      : { glyph: 'play', text: 'Start', run: 'start' },
      { glyph: 'restart', text: 'Restart', run: 'restart', off: !running },
      paused ? { glyph: 'resume', text: 'Resume', run: 'resume' }
      : { glyph: 'pause', text: 'Pause', run: 'pause', off: !running },
      { glyph: 'webui', text: 'WebUI', off: !(running && ct.webui), webui: true }
    ];

    var strip = U.el('div.sf-ctm-strip', { role: 'toolbar', 'aria-label': 'Run ' + name, 'data-sf-group': '' });
    slots.forEach(function (slot) {
      strip.appendChild(U.el('button.sf-ctm-act', {
        type: 'button',
        disabled: slot.off || (!!slot.run && busy),
        title: slot.webui && !ct.webui ? 'No WebUI' : null,
        onClick: act(function () {
          if (slot.webui) root.open(ct.webui, '_blank', 'noopener');
          else A.one(ct, slot.run);
        })
      }, [U.glyph(slot.glyph, 'sf-ctm-ico'), U.el('span', { text: slot.text })]));
    });
    pop.appendChild(strip);

    /* The native actions our table displaces. Delegating to core's own
     * functions keeps one implementation of each. */
    var list = U.el('div.sf-ctm-list', { 'data-sf-group': '' });
    if (typeof root.openTerminal === 'function') {
      list.appendChild(listRow('console', 'Console', !running, function () { root.openTerminal('docker', name, ct.shell || 'sh'); }));
      list.appendChild(listRow('logs', 'Logs', false, function () { root.openTerminal('docker', name, '.log'); }));
    }
    if (ct.template && typeof root.editContainer === 'function') {
      list.appendChild(listRow('edit', 'Edit container…', false, function () { root.editContainer(name, ct.template); }));
    }
    if (list.firstChild) pop.appendChild(list);

    pop.appendChild(detailsSection(ct));

    /* The folder as chips: one press moves it, None takes it out. */
    var chips = U.el('div.sf-ctm-chips', { role: 'group', 'aria-label': 'Folder', 'data-sf-group': '' });
    function chip(f) {
      var current = f ? !!folder && folder.id === f.id : !folder;
      return U.el('button.sf-ctm-chip' + (f ? '' : '.sf-ctm-none'), {
        type: 'button',
        'aria-pressed': current ? 'true' : 'false',
        'data-color': f ? (f.color || 'slate') : null,
        disabled: busy && !current,
        title: f ? U.plural((f.resolved || []).length, 'container') : null,
        onClick: current ? null : act(function () { A.assign(ct, f); })
      }, [
        f ? U.el('span.sf-ctm-ftile', { 'aria-hidden': 'true' }, [SF.render.folderIcon(f)]) : null,
        U.el('span.sf-ctm-chip-name', { text: f ? f.name : 'None' })
      ]);
    }
    chips.appendChild(chip(null));
    S.state.folders.forEach(function (f) { chips.appendChild(chip(f)); });
    chips.appendChild(U.el('button.sf-ctm-chip.sf-ctm-new', {
      type: 'button',
      disabled: busy,
      onClick: act(function () { SF.editor.open(null, { preselect: name }); })
    }, [U.glyph('plus', 'sf-ctm-ico'), U.el('span.sf-ctm-chip-name', { text: 'New folder' })]));

    pop.appendChild(U.el('div.sf-ctm-folder', null, [
      U.el('div.sf-menu-sub', { text: 'Folder' }),
      chips
    ]));

    /* Both ask first: ours for Force update, Unraid's own for Remove. */
    pop.appendChild(U.el('div.sf-ctm-foot', { 'data-sf-group': '' }, [
      U.el('button.sf-ctm-risk.sf-ctm-warn', {
        type: 'button',
        disabled: busy,
        onClick: act(function () { A.confirmForceUpdateOne(ct); })
      }, [U.glyph('force', 'sf-ctm-ico'), 'Force update…']),
      typeof root.rmContainer === 'function'
        ? U.el('button.sf-ctm-risk.sf-ctm-danger', {
            type: 'button',
            disabled: busy,
            onClick: act(function () { root.rmContainer(name, ct.image, ct.id); })
          }, [U.glyph('remove', 'sf-ctm-ico'), 'Remove…'])
        : null
    ]));

    mount(trigger, align, pop, onPopoverKey);

    var groups = popoverGroups(pop);
    if (groups.length) entryOf(groups[0]).focus();
    return pop;
  };

  /* ---------------------------------------------------------------------
   * Container details: network, address, MAC, created, volume mappings.
   * Folded by default, so the commands and folder chips stay where people
   * expect them; one click opens it.
   * ------------------------------------------------------------------- */
  var DETAILS_HINT = 'network, IP, MAC, volumes';

  function detailsSection(ct) {
    var body = U.el('div.sf-ctm-body', { hidden: true }, detailsBody(ct));
    var hint = U.el('span.sf-ctm-disc-hint', { text: DETAILS_HINT });
    var disc = U.el('button.sf-ctm-disc', {
      type: 'button',
      'aria-label': 'Details',
      'aria-expanded': 'false',
      onClick: function () {
        var opening = body.hidden;
        body.hidden = !opening;
        disc.setAttribute('aria-expanded', String(opening));
        hint.textContent = opening ? '' : DETAILS_HINT;
      }
    }, [U.el('span.sf-menu-sub', { text: 'Details' }), hint, U.el('span.sf-chevron-mark', { 'aria-hidden': 'true' })]);

    return U.el('div.sf-ctm-details', { 'data-sf-group': '' }, [disc, body]);
  }

  function detailsBody(ct) {
    var rows = [];
    function pair(term, value, mono) {
      rows.push(U.el('dt', { text: term }));
      rows.push(U.el('dd' + (mono ? '.sf-mono' : ''), { text: value || '—' }));
    }

    if (ct.via) pair('Network', 'via ' + ct.via);
    else if (!(ct.networks || []).length) pair('Network', ct.network || '');
    (ct.networks || []).forEach(function (n) {
      pair('Network', n.name);
      pair('IP', ct.state === 'running' || ct.state === 'paused' ? n.ip : '', true);
      pair('MAC', n.mac, true);
    });
    if (ct.created) {
      pair('Created', new Date(ct.created * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }));
    }

    var mounts = ct.mounts || [];
    return [
      U.el('dl.sf-ctm-dl', null, rows),
      U.el('div.sf-menu-sub.sf-ctm-vols', { text: 'Volume mappings' }),
      mounts.length
        ? U.el('ul.sf-ctm-mounts', null, mounts.map(function (m) {
            return U.el('li', null, [
              U.el('span', { text: m.dest }),
              U.el('span.sf-mount-host', { text: '→ ' + m.source + (m.rw ? '' : ' (read-only)') })
            ]);
          }))
        : U.el('div.sf-ctm-none-note', { text: 'None' })
    ];
  }

  /* ---------------------------------------------------------------------
   * Columns: which show, and in what order. Top to bottom in the list is
   * left to right in the table. A row moves by its grip or its arrows; the
   * arrows are the keyboard's way, since dragging has none.
   * ------------------------------------------------------------------- */
  M.columns = function (trigger) {
    if (M.isOpen('columns')) { M.close(); return null; }

    var pop = U.el('div.sf-menu.sf-cols', { role: 'dialog', 'aria-label': 'Columns' });
    fillColumns(pop);
    mount(trigger, 'left', pop, onColumnsKey, 'columns');
    trigger.setAttribute('aria-expanded', 'true');

    pop.addEventListener('change', function (e) {
      var key = e.target.getAttribute('data-col');
      if (!key) return;
      var S = SF.store;
      var hidden = S.state.columns.hidden.filter(function (k) { return k !== key; });
      if (!e.target.checked) hidden.push(key);
      S.setColumns(S.state.columns.order, hidden);
      refillColumns(pop, '[data-col="' + key + '"]');
    });
    pop.addEventListener('pointerdown', function (e) { startColumnDrag(e, pop); });

    var first = pop.querySelector('input[data-col]');
    if (first) first.focus();
    return pop;
  };

  function fillColumns(pop) {
    var S = SF.store;
    var cols = S.columns();

    U.clear(pop);
    pop.appendChild(U.el('div.sf-menu-head', { text: 'Columns' }));
    pop.appendChild(U.el('div.sf-cols-hint', { text: 'Top to bottom is left to right' }));
    pop.appendChild(U.el('div.sf-col-row.is-fixed', null, [
      U.el('span.sf-col-opt', null, [
        U.el('input', { type: 'checkbox', checked: true, disabled: true, 'aria-label': 'Container, always shown first' }),
        U.el('span.sf-menu-label', { text: 'Container' })
      ]),
      U.el('span.sf-menu-hint', { text: 'always first' })
    ]));

    var list = U.el('div.sf-col-list', { role: 'group', 'aria-label': 'Columns in table order', 'data-sf-group': '' });
    cols.forEach(function (c, i) {
      var label = SF.render.columnLabel(c.key);
      list.appendChild(U.el('div.sf-col-row', { 'data-key': c.key }, [
        U.el('button.sf-grip.sf-col-grip', {
          type: 'button', tabindex: '-1', 'aria-hidden': 'true', title: 'Drag to move ' + label
        }, [U.el('span.sf-grip-dots', { 'aria-hidden': 'true' })]),
        U.el('label.sf-col-opt', null, [
          U.el('input', { type: 'checkbox', 'data-col': c.key, checked: c.shown }),
          U.el('span.sf-menu-label', { text: label })
        ]),
        U.el('button.sf-fm-move', {
          type: 'button', 'data-move': 'up', 'aria-label': 'Move ' + label + ' up', title: 'Move up',
          disabled: i === 0,
          onClick: function () { moveColumn(pop, c.key, -1); }
        }, [U.glyph('up', 'sf-ctm-ico')]),
        U.el('button.sf-fm-move', {
          type: 'button', 'data-move': 'down', 'aria-label': 'Move ' + label + ' down', title: 'Move down',
          disabled: i === cols.length - 1,
          onClick: function () { moveColumn(pop, c.key, 1); }
        }, [U.glyph('down', 'sf-ctm-ico')])
      ]));
    });
    pop.appendChild(list);

    pop.appendChild(U.el('div.sf-menu-divider', { role: 'separator' }));
    pop.appendChild(U.el('div.sf-cols-foot', { 'data-sf-group': '' }, [
      U.el('span', { text: 'Saved for every device' }),
      U.el('button.sf-cols-reset', {
        type: 'button',
        title: 'Show every column, in the original order',
        onClick: function () { SF.store.resetColumns(); refillColumns(pop, '.sf-cols-reset'); }
      }, 'Reset')
    ]));
  }

  /* Rebuild the list in place and put focus back on the same control, or on
   * the first of the alternatives given that can take it. */
  function refillColumns(pop, focus) {
    fillColumns(pop);
    [].concat(focus || []).some(function (sel) {
      var node = pop.querySelector(sel);
      if (node && !node.disabled) { node.focus(); return true; }
      return false;
    });
  }

  function moveColumn(pop, key, step) {
    var S = SF.store;
    var order = S.state.columns.order.slice();
    var from = order.indexOf(key), to = from + step;
    if (from < 0 || to < 0 || to >= order.length) return;
    order.splice(from, 1);
    order.splice(to, 0, key);
    S.setColumns(order, S.state.columns.hidden);
    var dir = step < 0 ? 'up' : 'down', other = step < 0 ? 'down' : 'up';
    refillColumns(pop, ['[data-key="' + key + '"] [data-move="' + dir + '"]',
                        '[data-key="' + key + '"] [data-move="' + other + '"]']);
  }

  /* Dragging a row by its grip. The pointer is captured by the list's
   * popover, not the grip: the grip's row moves in the DOM while dragging. */
  function startColumnDrag(e, pop) {
    var grip = e.target.closest && e.target.closest('.sf-col-grip');
    if (!grip || e.button > 0) return;
    e.preventDefault();

    var row = grip.closest('.sf-col-row');
    var list = row.parentNode;
    var pointer = e.pointerId;
    row.classList.add('is-lifted');
    try { pop.setPointerCapture(pointer); } catch (err) { /* events still arrive */ }

    function onMove(ev) {
      if (ev.pointerId !== pointer) return;
      var before = null;
      var rows = Array.prototype.slice.call(list.children);
      for (var i = 0; i < rows.length; i++) {
        var box = rows[i].getBoundingClientRect();
        if (rows[i] !== row && ev.clientY < box.top + box.height / 2) { before = rows[i]; break; }
      }
      if (before === row.nextSibling || (before === null && row === list.lastChild)) return;
      list.insertBefore(row, before);
      /* The rows' order is the new column order. */
      var order = Array.prototype.map.call(list.children, function (r) { return r.getAttribute('data-key'); });
      SF.store.setColumns(order, SF.store.state.columns.hidden);
    }
    function onEnd(ev) {
      if (ev.pointerId !== pointer) return;
      pop.removeEventListener('pointermove', onMove);
      pop.removeEventListener('pointerup', onEnd);
      pop.removeEventListener('pointercancel', onEnd);
      refillColumns(pop, '[data-key="' + row.getAttribute('data-key') + '"] input');
    }
    pop.addEventListener('pointermove', onMove);
    pop.addEventListener('pointerup', onEnd);
    pop.addEventListener('pointercancel', onEnd);
  }

  /* Up and down move between rows, keeping to the same kind of control;
   * left and right move along a row. Tab goes between the list and Reset,
   * and past either end leaves and closes, as the other popovers do. */
  function onColumnsKey(e) {
    var pop = this;
    var active = document.activeElement;
    var row = active && active.closest ? active.closest('.sf-col-list .sf-col-row') : null;

    if (e.key === 'Tab') {
      e.preventDefault();
      var inList = !!row;
      if (inList && !e.shiftKey) { pop.querySelector('.sf-cols-reset').focus(); return; }
      if (!inList && e.shiftKey) { var cb = pop.querySelector('input[data-col]'); if (cb) cb.focus(); return; }
      M.close();
      return;
    }
    if (!row) return;

    var controls = function (r) {
      return Array.prototype.slice.call(r.querySelectorAll('input[data-col], [data-move]'))
        .filter(function (n) { return !n.disabled; });
    };

    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      var next = e.key === 'ArrowUp' ? row.previousElementSibling : row.nextElementSibling;
      if (!next) return;
      var kind = active.getAttribute('data-move');
      var same = kind ? next.querySelector('[data-move="' + kind + '"]') : null;
      (same && !same.disabled ? same : next.querySelector('input[data-col]')).focus();
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      var list = controls(row);
      var i = list.indexOf(active);
      var to = list[i + (e.key === 'ArrowRight' ? 1 : -1)];
      if (to) to.focus();
    }
  }

  /* Groups that have something to focus, in document order. */
  function popoverGroups(pop) {
    return Array.prototype.slice.call(pop.querySelectorAll('[data-sf-group]'))
      .map(function (node) {
        return { node: node, items: Array.prototype.slice.call(node.querySelectorAll('button:not([disabled])')) };
      })
      .filter(function (g) { return g.items.length; });
  }

  /* Entering the chips lands on the current folder. */
  function entryOf(group) {
    return group.node.querySelector('[aria-pressed="true"]:not([disabled])') || group.items[0];
  }

  /* Tab and Shift+Tab move between groups and close the popover past either
   * end, as leaving a menu does; the arrow keys move within a group. */
  function onPopoverKey(e) {
    var groups = popoverGroups(this);
    var at = -1;
    groups.forEach(function (g, i) { if (g.node.contains(document.activeElement)) at = i; });

    if (e.key === 'Tab') {
      e.preventDefault();
      var next = at + (e.shiftKey ? -1 : 1);
      if (next < 0 || next >= groups.length) { M.close(); return; }
      entryOf(groups[next]).focus();
      return;
    }

    var step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    if (!step || at < 0) return;
    e.preventDefault();
    var items = groups[at].items;
    var i = items.indexOf(document.activeElement);
    items[(i + step + items.length) % items.length].focus();
  }
})(window);
