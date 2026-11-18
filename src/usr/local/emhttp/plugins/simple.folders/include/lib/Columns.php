<?PHP
/* simple.folders - which table columns show, and in what order.
 * Copyright (C) 2026  gcarstoiu
 *
 * This program is free software; you can redistribute it and/or modify it
 * under the terms of the GNU General Public License version 2, as published
 * by the Free Software Foundation.
 *
 * Shape on disk:
 *
 *   { "order": ["status", "version", ...], "hidden": ["cport"] }
 *
 * Container (always first) and the row menu (always last) are not listed:
 * they can neither move nor hide. The keys match COLUMNS in render.js.
 */

require_once __DIR__.'/Paths.php';
require_once __DIR__.'/Guard.php';

/* Today's order. A key missing from a saved layout - a column added by a
 * later release - is appended in this order, shown. */
const SF_COLUMN_KEYS = ['status', 'version', 'network', 'cport', 'lan', 'cpu', 'memory', 'autostart'];

function sf_columns_default(): array {
  return ['order' => SF_COLUMN_KEYS, 'hidden' => []];
}

function sf_columns_load(): array {
  if (!is_file(SF_COLUMNS)) return sf_columns_default();
  $raw = json_decode((string)@file_get_contents(SF_COLUMNS), true);
  if (!is_array($raw)) return sf_columns_default();
  return sf_columns_clean((array)($raw['order'] ?? []), (array)($raw['hidden'] ?? []));
}

/* Known keys only, each once; anything missing joins the end. */
function sf_columns_clean(array $order, array $hidden): array {
  $clean = [];
  foreach ($order as $key) {
    if (in_array($key, SF_COLUMN_KEYS, true) && !in_array($key, $clean, true)) $clean[] = $key;
  }
  foreach (SF_COLUMN_KEYS as $key) {
    if (!in_array($key, $clean, true)) $clean[] = $key;
  }

  $off = [];
  foreach ($hidden as $key) {
    if (in_array($key, SF_COLUMN_KEYS, true) && !in_array($key, $off, true)) $off[] = $key;
  }
  return ['order' => $clean, 'hidden' => $off];
}

function sf_columns_save(array $columns): bool {
  sf_ensure_dirs();
  $payload = json_encode($columns, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
  return sf_write_atomic(SF_COLUMNS, $payload."\n");
}
