<?PHP
/* simple.folders harness - container source adapter.
 *
 * lib/Containers.php calls sf_containers_source() when SF_CONTAINER_SOURCE is
 * defined, instead of talking to DockerClient. This maps the harness fixture
 * state onto the exact shape sf_containers() returns on a real server, so the
 * plugin code under test is identical either way.
 *
 * NOT part of the plugin package. Never shipped.
 */
require_once __DIR__.'/state.php';

/* The address ports are published on, as DockerUtil::host() reports it. */
const HARNESS_HOST = '10.0.0.10';

function sf_containers_source(): array {
  $cts = harness_load();
  $docker = (array)(json_decode((string)file_get_contents(HARNESS_FIXTURES), true)['docker'] ?? []);

  $idToName = [];
  foreach ($cts as $ct) $idToName[$ct['id']] = $ct['name'];

  $out = [];
  foreach ($cts as $i => $ct) {
    $d = (array)($docker[$ct['name']] ?? []);
    $raw = harness_raw($ct, $d, $i);

    $out[] = [
      'name'      => $ct['name'],
      'id'        => $ct['id'],
      'image'     => $ct['image'],
      'state'     => $ct['state'],
      'update'    => (int)$ct['update'],
      'port'      => $ct['port'] ?: null,
      'ports'     => harness_ports($ct, $d),
      'autostart' => (bool)$ct['autostart'],
      'wait'      => (int)($ct['wait'] ?? 0),
      'webui'     => $ct['webui'] ?? '',
      /* The prototype stands in for real app logos with a letter on a tinted
       * tile; the fixtures carry the same two fields so the harness looks
       * like the screenshots without shipping third-party artwork. */
      'icon'      => '',
      'letter'    => $ct['letter'] ?? strtoupper(substr($ct['name'], 0, 1)),
      'tint'      => $ct['tint'] ?? 'slate',
      /* The real plugin gets CPU and memory from the dockerload nchan stream,
       * not from this payload. They are carried here only so a settled
       * screenshot (which turns the stream off) can show plausible figures. */
      'cpu'       => $ct['cpu'] ?? 0,
      'mem'       => $ct['mem'] ?? 0,
      'template'  => '/boot/config/plugins/dockerMan/templates-user/my-'.$ct['name'].'.xml',
      'shell'     => 'sh',
      'labels'    => $raw['Labels'],
    ] + sf_container_details($raw, $idToName, HARNESS_HOST);
  }
  usort($out, fn($a, $b) => strnatcasecmp($a['name'], $b['name']));
  return $out;
}

/* One /containers/json entry, built from the fixture. Harness actions change
 * only `state`, so Docker's State and Status are brought in line with it: a
 * container stopped from the page reads "Exited (0) 2 seconds ago". */
function harness_raw(array $ct, array $d, int $i): array {
  $status = (string)($d['status'] ?? '');
  $run    = (string)($d['run'] ?? '');

  if ($run === 'restarting') {
    /* stays restarting whatever the page does - a crash loop */
  } elseif ($ct['state'] === 'stopped') {
    $run = 'exited';
    if (strpos($status, 'Exited') !== 0) $status = 'Exited (0) 2 seconds ago';
  } elseif ($ct['state'] === 'paused') {
    $run = 'paused';
    $up = preg_match('/^Up (.+?)(?: \([^()]*\))?$/', $status, $m) ? $m[1] : '2 seconds';
    $status = "Up $up (Paused)";
  } else {
    $run = 'running';
    if (strpos($status, 'Up ') !== 0) $status = 'Up 2 seconds';
    $status = preg_replace('/ \(Paused\)$/', '', $status);
  }

  $net  = (array)($d['network'] ?? []);
  $mode = (string)($net['mode'] ?? 'bridge');
  $networks = [];
  if (strpos($mode, 'container:') !== 0) {
    $up = $run === 'running' || $run === 'paused';
    $ip = $up ? (string)($net['ip'] ?? ($mode === 'host' ? '' : '172.17.0.'.($i + 2))) : '';
    $mac = ($ip !== '' && $mode !== 'host') ? sprintf('02:42:ac:11:00:%02x', $i + 2) : '';
    $networks[$mode] = ['IPAddress' => $ip, 'MacAddress' => $mac];
  }

  $mounts = [];
  foreach ((array)($d['mounts'] ?? [['/config', '/mnt/user/appdata/'.$ct['name']]]) as $m) {
    $mounts[] = ['Type' => 'bind', 'Source' => $m[1], 'Destination' => $m[0], 'RW' => $m[2] ?? true];
  }

  return [
    'Id'              => $ct['id'],
    'State'           => $run,
    'Status'          => $status,
    'Created'         => 1773446400,            // 14 Mar 2026
    'Labels'          => array_merge((array)($ct['labels'] ?? []), (array)($d['labels'] ?? [])),
    'HostConfig'      => ['NetworkMode' => $mode],
    'NetworkSettings' => ['Networks' => $networks],
    'Mounts'          => $mounts,
  ];
}

/* Same shape sf_port_columns() builds on a real server: host networking
 * reaches everything on the server's address; a br0 container has its own
 * address and maps nothing through the host. */
function harness_ports(array $ct, array $d): array {
  $net  = (array)($d['network'] ?? []);
  $mode = (string)($net['mode'] ?? 'bridge');
  if ($mode === 'host') return ['internal' => ['all'], 'external' => [HARNESS_HOST]];
  if (!empty($net['vlan'])) return ['internal' => [], 'external' => [(string)$net['ip']]];
  return [
    'internal' => $ct['port'] ? [$ct['port'].':TCP'] : [],
    'external' => ($ct['port'] && $ct['state'] !== 'stopped') ? [HARNESS_HOST.':'.$ct['port']] : [],
  ];
}
