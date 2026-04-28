<?php
// SPDX-License-Identifier: AGPL-3.0-only
$path = '/data/notes.txt';
if (!is_dir('/data')) {
    mkdir('/data', 0777, true);
}
file_put_contents($path, date('c') . " hit\n", FILE_APPEND);
header('Content-Type: application/json');
echo json_encode([
    'ok' => true,
    'lines' => count(file($path)),
]);
