<?PHP
/* simple.folders harness - a stand-in for Unraid's Docker page.
 *
 * Reproduces exactly what the plugin is entitled to assume is present when its
 * simple.folders.Docker.page is rendered inside the Docker tab:
 *
 *   - jQuery (Unraid ships 3.x) and the NchanSubscriber global
 *   - var csrf_token, and $.post patched to append it (webGUI does this in
 *     DefaultPageLayout/HeadInlineJS.php)
 *   - var docker = [], loadlist(), and the #docker_containers table
 *   - the .js-actions button row, body theme class, and _() translation stub
 *
 * The Docker tab's pages are rendered in emhttp's order, so the plugin page's
 * own Menu= decides where it lands. ?compose=1 adds a stand-in for Compose
 * Manager's section (Docker:2); ?tabbed=1 renders the tab the way Unraid's
 * "Tabbed" page view does.
 *
 * NOT part of the plugin package. Never shipped.
 */
$theme = preg_replace('/[^a-z]/', '', $_GET['theme'] ?? 'black');

/* ?nostream=1 turns off the live CPU/memory subscription. The nchan channel
 * is a long poll that by design never ends, which means a headless browser
 * never sees the page go idle - so screenshots and DOM dumps need a way to
 * opt out. Only the two live columns are affected. */
$nostream = isset($_GET['nostream']);
$plugin = __DIR__.'/../../src/usr/local/emhttp/plugins/simple.folders';
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Docker — harness (<?=htmlspecialchars($theme)?>)</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jquery/3.7.1/jquery.min.js"></script>
<script src="/webGui/javascript/nchan.js"></script>
<!-- Unraid's element styling, which a plugin's UI has to survive. See the
     file header: without this the harness is friendlier than a real server
     and CSS collisions ship undetected. -->
<link rel="stylesheet" href="/webGui/styles/unraid-base-excerpt.css">
<style>
  /* A deliberately minimal stand-in for Unraid's stylesheets: enough structure
     to catch layout mistakes, not enough to mask them. */
  body { margin:0; font-family:system-ui,sans-serif; background:#1b1b1b; color:#e0e0e0; }
  body.white, body.azure { background:#f2f2f2; color:#1b1b1b; }
  .harness-bar { padding:8px 16px; background:#000; color:#9aa1ab; font:12px/1.6 ui-monospace,monospace;
                 display:flex; gap:16px; align-items:center; flex-wrap:wrap; }
  .harness-bar a { color:#6EA8FE; }
  .title { padding:16px; font-size:1.6rem; }
  .TableContainer { padding:0 16px; }
  table#docker_containers { width:100%; border-collapse:collapse; }
  #docker_containers th, #docker_containers td { padding:6px; border-bottom:1px solid #333; text-align:left; font-size:13px; }
  .js-actions { padding:16px; display:flex; gap:8px; flex-wrap:wrap; }
  #compose_stacks { width:100%; border-collapse:collapse; background:transparent; color:inherit; }
  #compose_stacks th, #compose_stacks td { padding:6px; border-bottom:1px solid #333; text-align:left; font-size:13px; }
  .advanced { display:none; }
  .tabs-container { display:flex; gap:4px; padding:12px 16px 0; }
  /* An underline, not a fill: Unraid's button:hover sets the fill !important. */
  .tabs-container [role="tab"] { padding:8px 14px; color:inherit; border:0; border-bottom:2px solid transparent; cursor:pointer; }
  .tabs-container [role="tab"][aria-selected="true"] { border-bottom-color:#6EA8FE; }
</style>
</head>
<body class="<?=htmlspecialchars($theme)?>">

<div class="harness-bar">
  <strong style="color:#fff">simple.folders harness</strong>
  <span>theme:</span>
  <?php foreach (['black','white','azure','gray'] as $t): ?>
    <a href="?theme=<?=$t?>"><?=$t?></a>
  <?php endforeach; ?>
  <span style="margin-left:auto">
    <a href="/_reset">reset container state</a>
  </span>
</div>

<script>
/* PHP's built-in server cannot do websockets, so tell the plugin to use the
   long-poll transport NchanSubscriber also supports. Must be set before the
   plugin page's inline config runs. */
window.SimpleFolders = { nchanTransport: <?= $nostream ? "'none'" : "'longpoll'" ?> };

/* ?folded=<id,id|all> presets the per-viewer fold state before app.js reads
   it, so a headless capture can show folded folders without clicking. */
<?php if (isset($_GET['folded'])): ?>
try {
  var want = <?= json_encode((string)$_GET['folded']) ?>;
  var map = {};
  (want === 'all' ? ['f-media','f-home','f-ai'] : want.split(',')).forEach(function (id) { map[id] = false; });
  localStorage.setItem('simple.folders:expanded', JSON.stringify(map));
} catch (e) {}
<?php endif; ?>

/* ---- globals the webGUI guarantees to every page ---------------------- */
var csrf_token = "0123456789ABCDEF";
var docker = [];
var timers = {};

/* webGUI patches every jQuery POST to carry the token. Reproduced because a
   plugin that forgets it passes locally and 403s on real hardware. */
$.ajaxSetup({ beforeSend: function (jqXHR, s) {
  if (s.type === 'POST' && typeof s.data === 'string' && s.data.indexOf('csrf_token=') === -1) {
    s.data += (s.data ? '&' : '') + 'csrf_token=' + csrf_token;
  }
}});

/* Unraid's translation helper. */
function _(s) { return s; }

/* The native list loader. The plugin hides this table rather than removing it,
   and must keep it working for "Classic view". */
function loadlist(init) {
  $.get('/plugins/dynamix.docker.manager/include/DockerContainers.php', function (d) {
    var data = d.split(/\0/);
    docker = [];
    $('#docker_list').html(data[0]);
    (new Function(data[1]))();
    $('input[type=button]').prop('disabled', false).show();
    $(document).trigger('simple.folders:loadlist');
  });
}

/* Native actions the plugin's container menu delegates to. */
function addContainer()  { alert('[harness] Add Container page'); }
function editContainer(n, t) { alert('[harness] edit ' + n); }
function openTerminal(k, n, s) { alert('[harness] ' + (s === '.log' ? 'logs' : 'console') + ' for ' + n); }
function rmContainer(n, i, id) { alert('[harness] remove ' + n); }
function startAll()  { $.post('/plugins/dynamix.docker.manager/include/ContainerManager.php', {action:'start'},  loadlist); }
function stopAll()   { $.post('/plugins/dynamix.docker.manager/include/ContainerManager.php', {action:'stop'},   loadlist); }
function checkAll()  { $.post('/plugins/dynamix.docker.manager/include/DockerUpdate.php', {}, loadlist); }
function updateAll() { alert('[harness] update all'); }

$(function () { loadlist(true); });
</script>

<?php ob_start(); ?>
<div class="TableContainer">
  <table id="docker_containers" class="tablesorter shift">
    <thead>
      <tr>
        <th>Application</th><th>Version</th><th>Network</th><th>Container IP</th>
        <th>Container Port</th><th>LAN IP:Port</th><th>Volume Mappings</th>
        <th class="load advanced">CPU &amp; Memory load</th>
        <th class="nine">Autostart</th><th class="five">Uptime</th>
      </tr>
    </thead>
    <tbody id="docker_list"><tr><td colspan="10"></td></tr></tbody>
  </table>
</div>

<div class="js-actions">
  <input type="button" onclick="addContainer()" value="Add Container" style="display:none">
  <input type="button" onclick="startAll()" value="Start All" style="display:none">
  <input type="button" onclick="stopAll()" value="Stop All" style="display:none">
  <input type="button" onclick="checkAll()" value="Check for Updates" id="checkAll" style="display:none">
  <input type="button" onclick="updateAll()" value="Update All" id="updateAll" style="display:none">
</div>
<?php $stockHtml = ob_get_clean(); ?>

<?php ob_start(); ?>
<div class="TableContainer">
  <table id="compose_stacks" class="tablesorter shift">
    <thead><tr><th>Stack</th><th>Status</th><th>Containers</th><th>Autostart</th></tr></thead>
    <tbody>
      <tr><td>monitoring</td><td>running</td><td>3</td><td>on</td></tr>
      <tr><td>documents</td><td>running</td><td>4</td><td>on</td></tr>
      <tr><td>wiki</td><td>stopped</td><td>2</td><td>off</td></tr>
    </tbody>
  </table>
</div>
<?php $composeHtml = ob_get_clean(); ?>

<?php
/* Render the plugin page the way emhttp does: read the header above the ---
   separator, then evaluate the rest as PHP+HTML. */
$page = $plugin.'/simple.folders.Docker.page';
$pluginMenu = '';
if (file_exists($page)) {
  $raw  = file_get_contents($page);
  $cut  = strpos($raw, "\n---\n");
  $body = $cut !== false ? substr($raw, $cut + 5) : $raw;
  $pluginMenu = $cut !== false ? (@parse_ini_string(substr($raw, 0, $cut))['Menu'] ?? '') : '';
  /* Unraid's page parser also expands _(...)_ translation markers. */
  $body = preg_replace('/_\((.*?)\)_/', '$1', $body);
  ob_start();
  eval('?>'.$body);
  $pluginHtml = ob_get_clean();
} else {
  $pluginHtml = '<p style="padding:16px;color:#FF9B9B">plugin page not found: '.htmlspecialchars($page).'</p>';
}

/* The Docker tab's pages, ordered as emhttp's find_pages() orders them: keyed
   "<rank><name>" and natural-sorted, so a page with no rank sorts last. Each
   titled page gets a heading, as in the non-tabbed layout. */
$pages = [
  ['name' => 'DockerContainers', 'Menu' => 'Docker:1', 'Title' => 'Docker Containers', 'html' => $stockHtml],
  ['name' => 'simple.folders.Docker', 'Menu' => $pluginMenu, 'html' => $pluginHtml],
];
if (isset($_GET['compose'])) {
  $pages[] = ['name' => 'compose.manager', 'Menu' => 'Docker:2', 'Title' => 'Compose', 'html' => $composeHtml];
}
$tab = [];
foreach ($pages as $p) {
  [$menu, $rank] = array_pad(explode(':', $p['Menu'], 2), 2, '');
  if ($menu === 'Docker') $tab[$rank.$p['name']] = $p;
}
ksort($tab, SORT_NATURAL);

if (!isset($_GET['tabbed'])) {
  foreach ($tab as $p) {
    if (isset($p['Title'])) echo '<div class="title">'.htmlspecialchars($p['Title'])."</div>\n";
    echo $p['html'], "\n";
  }
} else {
  /* MainContentTabbed.php: a tab and a panel per titled page; a page with no
     Title is output between the panels, inside none of them. */
  $i = 0;
  echo '<div id="displaybox"><nav class="tabs" role="tablist"><div class="tabs-container">';
  foreach ($tab as $p) {
    if (!isset($p['Title'])) continue;
    $i++;
    echo '<button role="tab" id="tab'.$i.'">'.htmlspecialchars($p['Title']).'</button>';
  }
  echo "</div></nav>\n";
  $i = 0;
  foreach ($tab as $p) {
    if (!isset($p['Title'])) { echo $p['html'], "\n"; continue; }
    $i++;
    echo '<section id="tab'.$i.'-panel" role="tabpanel" class="tab-content content">', $p['html'], "</section>\n";
  }
  echo "</div>\n";
?>
<script>
/* Unraid's tab switcher, reduced: one panel shown, the rest display:none. */
(function () {
  var tabs = document.querySelectorAll('.tabs [role="tab"]');
  var panels = document.querySelectorAll('[role="tabpanel"]');
  function show(i) {
    tabs.forEach(function (t, j) { t.setAttribute('aria-selected', j === i ? 'true' : 'false'); });
    panels.forEach(function (p, j) { p.style.display = j === i ? 'block' : 'none'; });
  }
  tabs.forEach(function (t, i) { t.addEventListener('click', function () { show(i); }); });
  show(0);
})();
</script>
<?php
}
?>
</body>
</html>
