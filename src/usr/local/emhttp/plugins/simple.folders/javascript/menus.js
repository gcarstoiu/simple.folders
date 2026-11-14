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
  function mount(trigger, align, node, onKey) {
    M.close();
    U.layer().appendChild(node);
    position(node, trigger, align);

    open = { node: node, trigger: trigger };

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
    if (open && !open.node.contains(e.target)) M.close();
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
    if (open.node.parentNode) open.node.parentNode.removeChild(open.node);
    open = null;

    /* Focus goes back where it came from (spec 6). */
    if (trigger && document.contains(trigger)) trigger.focus();
    return true;
  };

  M.isOpen = function () { return !!open; };

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
