<?PHP
/* simple.folders - reading the container list.
 * Copyright (C) 2026  gcarstoiu
 *
 * This program is free software; you can redistribute it and/or modify it
 * under the terms of the GNU General Public License version 2, as published
 * by the Free Software Foundation.
 *
 * WHY THIS DOES NOT PARSE THE DOCKER PAGE
 * ---------------------------------------
 * The obvious shortcut is to scrape the rows that
 * dynamix.docker.manager/include/DockerContainers.php renders. Don't: that
 * file's markup changed substantially between Unraid 7.2.1 and 7.4, and it is
 * the single biggest reason folder plugins break on upgrade.
 *
 * Instead we call the same PHP classes that file calls - DockerClient and
 * DockerTemplates - whose public methods have been stable across the same
 * range. We also read the raw /containers/json payload once, because
 * getDockerContainers() drops arbitrary labels and we need ours.
 *
 * CPU and memory are deliberately NOT read here. "docker stats" costs a
 * second or more per call; the page subscribes to the dockerload nchan channel
 * instead and fills those columns as samples arrive.
 */

require_once __DIR__.'/Paths.php';

/* The harness points this at a fixture reader. Production never defines it. */
if (defined('SF_CONTAINER_SOURCE') && is_file(SF_CONTAINER_SOURCE)) {
  require_once SF_CONTAINER_SOURCE;
}

/* ---------------------------------------------------------------------------
 * DockerClient.php MUST be required here, at file scope - never from inside a
 * function.
 *
 * It declares $dockerManPaths, $driver, $docroot and $dockercfg at ITS top
 * level, and thirteen of its methods reach for them with `global`. An include
 * takes the scope of whatever included it, so requiring it inside a function
 * makes those four function-locals instead of globals, every `global` lookup
 * resolves to null, and the class fails at runtime with no useful message.
 * ------------------------------------------------------------------------- */
if (!function_exists('sf_containers_source')) {
  $dfDockerClient = SF_DOCKER_MAN.'/include/DockerClient.php';

  /* DockerClient derives $docroot from this when it is not already set. */
  $_SERVER['DOCUMENT_ROOT'] = $_SERVER['DOCUMENT_ROOT'] ?: '/usr/local/emhttp';
  $docroot = $docroot ?? $_SERVER['DOCUMENT_ROOT'];

  if (is_file($dfDockerClient)) {
    require_once $dfDockerClient;
  }
  unset($dfDockerClient);
}

/* Return every container, name-sorted, in the shape the UI consumes.
 *
 *   [ name, id, image, state, update, port, autostart, wait, webui,
 *     icon, template, shell, labels{} ]  plus sf_container_details()
 *
 * state  : running | paused | stopped
 * update : 0 up to date | 1 update ready | 2 rebuild ready | 3 unknown
 */
function sf_containers(): array {
  /* The display order is this plugin's behaviour, not a property of where
   * the container list came from - so it is applied to both paths. Applying
   * it only to the real one left it untested by the harness, which is how
   * it shipped doing nothing. */
  if (function_exists('sf_containers_source')) {
    return sf_apply_display_order(sf_containers_source());
  }

  /* Required at file scope above; see the note there for why. */
  if (!class_exists('DockerClient')) {
    throw new RuntimeException(
      'Unraid\'s Docker manager was not found at '.SF_DOCKER_MAN.
      '. Is the Docker service enabled?'
    );
  }

  $DockerClient    = new DockerClient();
  $DockerTemplates = new DockerTemplates();

  $containers = $DockerClient->getDockerContainers();

  /* An empty list is legitimate - a server can genuinely have no containers.
   * It is only an error when the Docker service itself is not up, so
   * distinguish the two rather than silently rendering "0 containers" when
   * the real problem is that dockerd is stopped. */
  if (!$containers) {
    if (!is_file('/var/run/dockerd.pid')) {
      throw new RuntimeException('The Docker service is not running. Start it in Settings - Docker.');
    }
    return [];
  }

  /* getAllInfo() resolves icon, WebUI URL, autostart, update status and the
   * user template for every container in one pass. */
  $allInfo = $DockerTemplates->getAllInfo();

  /* Labels, health, exit codes, networks and mounts are not exposed by
   * getDockerContainers(), so take them from the raw list endpoint - one
   * call, not one inspect per container. */
  $labels = [];
  $rawByName = [];
  $idToName = [];
  foreach ((array)$DockerClient->getDockerJSON('/containers/json?all=1') as $raw) {
    $name = ltrim($raw['Names'][0] ?? '', '/');
    if ($name === '') continue;
    $labels[$name] = (array)($raw['Labels'] ?? []);
    $rawByName[$name] = (array)$raw;
    if (!empty($raw['Id'])) $idToName[(string)$raw['Id']] = $name;
  }

  /* Per-container autostart wait, as stored in Unraid's autostart file:
   * one "<name> <seconds>" line per container, in start order. */
  $waits = sf_autostart_waits();

  /* The LAN address ports are published on, for the "LAN IP:Port" column. */
  $host = class_exists('DockerUtil') ? DockerUtil::host() : '';

  $out = [];
  foreach ($containers as $ct) {
    $name = $ct['Name'];
    $info = $allInfo[$name] ?? [];

    $state = !empty($info['paused']) ? 'paused'
           : (!empty($info['running']) ? 'running' : 'stopped');

    /* getAllInfo() encodes update status as a string; map it to the same
     * integers core's docker[] array uses so both sides agree.
     * 2 means "rebuild ready" - the image is there but the container was
     * built against a network that no longer exists. */
    $updated = $info['updated'] ?? null;
    $update  = substr($ct['NetworkMode'], -4) === ':???' ? 2
             : ($updated === 'true' ? 0 : ($updated === 'false' ? 1 : 3));

    $out[] = [
      'name'      => $name,
      'id'        => $ct['Id'],
      'image'     => $ct['Image'],
      'state'     => $state,
      'update'    => $update,
      'port'      => sf_primary_port($ct),
      'ports'     => sf_port_columns($ct, $host),
      'autostart' => !empty($info['autostart']),
      'wait'      => $waits[$name] ?? 0,
      'webui'     => html_entity_decode($info['url'] ?? ''),
      'icon'      => $info['icon'] ?? '',
      'template'  => $info['template'] ?? '',
      'shell'     => $info['shell'] ?? '',
      'labels'    => $labels[$name] ?? [],
    ] + sf_container_details($rawByName[$name] ?? [], $idToName, $host);
  }

  return sf_apply_display_order($out);
}

/* ---------------------------------------------------------------------------
 * What the list endpoint says beyond Unraid's own summary: health, uptime,
 * exit code, network, mounts, creation time, and the version and Compose
 * labels. $raw is one entry of /containers/json; the harness builds the same
 * shape from its fixtures, so this runs under test too.
 *
 *   run       Docker's own state: running | paused | restarting | exited |
 *             created | dead | removing
 *   health    '' | healthy | unhealthy | starting
 *   exitCode  last exit code, or null when Docker gives none
 *   since     "3 days" while up, "2 days ago" once exited (Docker's words)
 *   network   the container's main network; networks lists every one
 *   via       for container:<other> networking, the other container's name
 * ------------------------------------------------------------------------- */
function sf_container_details(array $raw, array $idToName, string $host): array {
  $status = sf_parse_status((string)($raw['State'] ?? ''), (string)($raw['Status'] ?? ''));
  $labels = is_array($raw['Labels'] ?? null) ? $raw['Labels'] : [];

  return $status + sf_network_details($raw, $idToName, $host) + [
    'mounts'  => sf_mounts($raw['Mounts'] ?? []),
    'created' => (int)($raw['Created'] ?? 0),
    'version' => sf_label_text($labels['org.opencontainers.image.version'] ?? ''),
    'stack'   => sf_label_text($labels['com.docker.compose.project'] ?? ''),
  ];
}

/* Docker words Status as "Up 3 days (healthy)", "Up 20 seconds (health:
 * starting)", "Up 3 days (Paused)", "Exited (137) 6 hours ago",
 * "Restarting (1) 8 seconds ago" or just "Created". */
function sf_parse_status(string $state, string $status): array {
  $out = ['run' => strtolower($state), 'health' => '', 'exitCode' => null,
          'since' => '', 'statusText' => $status];
  $status = trim($status);

  if (preg_match('/^Up (.+?)(?: \(([^()]+)\))?$/', $status, $m)) {
    $out['since'] = lcfirst($m[1]);
    $note = strtolower($m[2] ?? '');
    if ($note === 'healthy' || $note === 'unhealthy') $out['health'] = $note;
    elseif ($note === 'health: starting')             $out['health'] = 'starting';
    if ($out['run'] === '') $out['run'] = $note === 'paused' ? 'paused' : 'running';
  } elseif (preg_match('/^(Exited|Restarting) \((-?\d+)\) (.+)$/', $status, $m)) {
    $out['exitCode'] = (int)$m[2];
    $out['since'] = lcfirst($m[3]);
    if ($out['run'] === '') $out['run'] = strtolower($m[1]) === 'exited' ? 'exited' : 'restarting';
  } elseif ($out['run'] === '' && $status === 'Created') {
    $out['run'] = 'created';
  }
  return $out;
}

/* The network the container runs on, and every network it is attached to.
 * Host networking has no address of its own, so it shows the server's. */
function sf_network_details(array $raw, array $idToName, string $host): array {
  $mode = (string)($raw['HostConfig']['NetworkMode'] ?? '');
  $nets = is_array($raw['NetworkSettings']['Networks'] ?? null) ? $raw['NetworkSettings']['Networks'] : [];

  if (strpos($mode, 'container:') === 0) {
    /* Docker stores the other container by id or by name; show its name. */
    $ref = substr($mode, 10);
    $via = $idToName[$ref] ?? null;
    if ($via === null && $ref !== '') {
      foreach ($idToName as $id => $name) {
        if ($name === $ref || strpos($id, $ref) === 0) { $via = $name; break; }
      }
    }
    return ['network' => '', 'via' => $via ?? substr($ref, 0, 12), 'networks' => []];
  }

  $list = [];
  foreach ($nets as $name => $net) {
    $name = (string)$name;
    $ip = (string)($net['IPAddress'] ?? '');
    if ($name === 'host' && $ip === '') $ip = $host;
    $list[] = ['name' => $name, 'ip' => $ip, 'mac' => (string)($net['MacAddress'] ?? '')];
  }

  /* The mode names the main network; list it first. "default" is bridge. */
  $main = $mode === 'default' ? 'bridge' : $mode;
  usort($list, fn($a, $b) => ($b['name'] === $main) <=> ($a['name'] === $main));
  if (!$list && $main !== '') $list[] = ['name' => $main, 'ip' => $main === 'host' ? $host : '', 'mac' => ''];

  return ['network' => $list[0]['name'] ?? '', 'via' => '', 'networks' => $list];
}

/* Volume mappings, container path first: [{dest, source, rw}]. */
function sf_mounts($mounts): array {
  $out = [];
  foreach ((array)$mounts as $m) {
    if (!is_array($m) || empty($m['Destination'])) continue;
    $out[] = [
      'dest'   => (string)$m['Destination'],
      'source' => (string)($m['Source'] ?? ($m['Name'] ?? '')),
      'rw'     => !array_key_exists('RW', $m) || (bool)$m['RW'],
    ];
  }
  return $out;
}

/* Label values go straight into the page; keep them short and single-line. */
function sf_label_text($value): string {
  $value = trim(preg_replace('/\s+/', ' ', (string)$value));
  return mb_substr($value, 0, 64);
}

/* Order containers the way Unraid's stock Docker page does: by the position
 * recorded in userprefs.cfg, with anything unlisted after, name-sorted. The
 * stock table and this one then agree. */
function sf_apply_display_order(array $containers): array {
  $order = sf_display_order();

  usort($containers, function ($a, $b) use ($order) {
    $ia = $order[$a['name']] ?? PHP_INT_MAX;
    $ib = $order[$b['name']] ?? PHP_INT_MAX;
    if ($ia !== $ib) return $ia <=> $ib;
    return strnatcasecmp($a['name'], $b['name']);
  });
  return $containers;
}

/* [name => position] from userprefs.cfg, whose lines are <index>="<name>". */
function sf_display_order(): array {
  if (!is_file(SF_USER_PREFS)) return [];
  $prefs = @parse_ini_file(SF_USER_PREFS);
  if (!is_array($prefs)) return [];

  $order = [];
  foreach ($prefs as $index => $name) {
    if (is_string($name) && $name !== '') $order[$name] = (int)$index;
  }
  return $order;
}

/* The two port columns, matching what Unraid's own Docker page shows:
 *
 *   internal  "<PrivatePort>:<TYPE>"      -> the Container Port column
 *   external  "<HostIp>:<PublicPort>"     -> the LAN IP:Port column
 *
 * Host networking is a special case in both: everything is reachable, so the
 * container side reads "all" and the LAN side is the network's own address.
 * Containers on an ipvlan/macvlan network publish nothing through the host,
 * so neither column applies.
 *
 * Logic mirrors dynamix.docker.manager/include/DockerContainers.php, except
 * that this de-duplicates: that loop walks every network and re-reads every
 * port inside each, so a container on two networks lists its ports twice.
 */
function sf_port_columns(array $ct, string $host): array {
  $internal = [];
  $external = [];

  $networks = is_array($ct['Networks'] ?? null) ? $ct['Networks'] : [];
  $ports    = is_array($ct['Ports'] ?? null) ? $ct['Ports'] : [];
  $isHost   = isset($networks['host']);
  $isVlan   = isset($ports['vlan']);

  if ($isHost) {
    foreach ($networks as $net) {
      if (!empty($net['IPAddress'])) $external[] = (string)$net['IPAddress'];
    }
    $internal[] = 'all';
    return ['internal' => array_values(array_unique($internal)),
            'external' => array_values(array_unique($external))];
  }

  if ($isVlan && strpos((string)($ct['NetworkMode'] ?? ''), 'container:') === false) {
    /* On an ipvlan/macvlan the container has its own LAN address and nothing
     * is mapped through the host. */
    foreach ($ports['vlan'] as $ip) if ($ip) $external[] = (string)$ip;
    return ['internal' => [], 'external' => array_values(array_unique($external))];
  }

  foreach ($ports as $port) {
    if (!is_array($port) || empty($port['PrivatePort'])) continue;   // skips 'host'/'vlan'


    $internal[] = $port['PrivatePort'].':'.strtoupper((string)($port['Type'] ?? 'tcp'));

    if (!empty($port['PublicPort']) && ($port['Driver'] ?? '') === 'bridge') {
      $ip = !empty($port['HostIp']) ? $port['HostIp'] : $host;
      $external[] = ($ip !== '' ? $ip.':' : '').$port['PublicPort'];
    }
  }

  return ['internal' => array_values(array_unique($internal)),
          'external' => array_values(array_unique($external))];
}

/* The port shown in the Port column: the first published (host) port, falling
 * back to the first exposed one. Returns null when the container publishes
 * nothing, which the UI renders as an em dash. */
function sf_primary_port(array $ct): ?int {
  $ports = $ct['Ports'] ?? [];
  if (!is_array($ports)) return null;

  foreach ($ports as $port) {
    if (is_array($port) && !empty($port['PublicPort'])) return (int)$port['PublicPort'];
  }
  foreach ($ports as $port) {
    if (is_array($port) && !empty($port['PrivatePort'])) return (int)$port['PrivatePort'];
  }
  return null;
}

/* Parse /var/lib/docker/unraid-autostart into [name => wait seconds].
 * Line format is "<name> <seconds>"; the seconds part is optional. */
function sf_autostart_waits(): array {
  $file = SF_DOCKER_MAN_AUTOSTART;
  if (!is_file($file)) return [];

  $waits = [];
  foreach ((array)@file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
    $parts = preg_split('/\s+/', trim($line), 2);
    if ($parts[0] === '') continue;
    $waits[$parts[0]] = isset($parts[1]) ? (int)$parts[1] : 0;
  }
  return $waits;
}

/* The autostart file's order is Unraid's own container start order, and
 * DESIGN_SPEC.md 13.9 makes folder start order drive it rather than shadow it. */
function sf_autostart_order(): array {
  $file = SF_DOCKER_MAN_AUTOSTART;
  if (!is_file($file)) return [];

  $order = [];
  foreach ((array)@file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
    $name = preg_split('/\s+/', trim($line), 2)[0];
    if ($name !== '') $order[] = $name;
  }
  return $order;
}
