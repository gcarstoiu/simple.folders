<?PHP
/* simple.folders - saving the table's column layout.
 * Copyright (C) 2026  gcarstoiu
 *
 * This program is free software; you can redistribute it and/or modify it
 * under the terms of the GNU General Public License version 2, as published
 * by the Free Software Foundation.
 *
 *   POST action=set order=<key,key,...> hidden=<key,...>
 *
 * The layout is read back by Data.php with everything else.
 */

require_once __DIR__.'/lib/Paths.php';
require_once __DIR__.'/lib/Guard.php';

sf_install_error_handler();

require_once __DIR__.'/lib/Columns.php';

sf_require_post();

if (($_POST['action'] ?? '') !== 'set') sf_fail('Unknown action');

$split = fn($raw) => array_values(array_filter(array_map('trim', explode(',', (string)$raw)), 'strlen'));
$columns = sf_columns_clean($split($_POST['order'] ?? ''), $split($_POST['hidden'] ?? ''));

if (!sf_columns_save($columns)) sf_fail('Could not write '.SF_COLUMNS, 500);

sf_ok(['columns' => $columns]);
