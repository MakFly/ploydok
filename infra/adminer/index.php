<?php
// SPDX-License-Identifier: AGPL-3.0-only
declare(strict_types=1);

namespace PloydokAdminer {
	const DRIVER_KEYS = [
		"server",
		"pgsql",
		"sqlite",
		"oracle",
		"mssql",
		"elastic",
		"mongo",
		"clickhouse",
		"simpledb",
		"firebird",
	];

	function header_value(string $name): string {
		$key = "HTTP_X_PLOYDOK_ADMINER_" . strtoupper(str_replace("-", "_", $name));
		return trim((string) ($_SERVER[$key] ?? ""));
	}

	function target(): ?array {
		$driver = header_value("driver");
		$server = header_value("server");
		$database = header_value("database");
		$username = header_value("username");

		if (!in_array($driver, ["pgsql", "server"], true) || $server === "" || $database === "" || $username === "") {
			return null;
		}

		return [
			"driver" => $driver,
			"server" => $server,
			"database" => $database,
			"username" => $username,
		];
	}

	function bootstrap_request(): void {
		$target = target();
		if ($target === null) {
			http_response_code(403);
			echo "Missing Ploydok Adminer session headers.";
			exit;
		}

		ini_set("session.name", "ploydok_adminer");

		if (isset($_POST["auth"]) && is_array($_POST["auth"])) {
			$_POST["auth"]["driver"] = $target["driver"];
			$_POST["auth"]["server"] = $target["server"];
			$_POST["auth"]["db"] = $target["database"];
			$_POST["auth"]["username"] = $target["username"];
			unset($_POST["auth"]["permanent"]);
		}

		foreach (DRIVER_KEYS as $driverKey) {
			if ($driverKey !== $target["driver"]) {
				unset($_GET[$driverKey]);
			}
		}

		$_GET[$target["driver"]] = $target["server"];
		if (isset($_GET["username"])) {
			$_GET["username"] = $target["username"];
		}
		if (isset($_GET["db"])) {
			$_GET["db"] = $target["database"];
		}
	}

	function h(string $value): string {
		return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, "UTF-8");
	}

	function adminer_object() {
		if (!class_exists(__NAMESPACE__ . "\\LockedTargetPlugin", false)) {
			final class LockedTargetPlugin extends \Adminer\Plugin {
				public function __construct(private array $target) {}

				public function credentials(): array {
					return [
						$this->target["server"],
						$this->target["username"],
						\Adminer\get_password(),
					];
				}

				public function login($login, $password) {
					if (
						\Adminer\DRIVER !== $this->target["driver"] ||
						\Adminer\SERVER !== $this->target["server"] ||
						\Adminer\DB !== $this->target["database"] ||
						$login !== $this->target["username"]
					) {
						return "This Adminer session is locked to the selected Ploydok database.";
					}
					return true;
				}

				public function permanentLogin($create = false) {
					return false;
				}

				public function loginFormField($name, $heading, $value) {
					if ($name === "password") {
						return $heading . $value . "\n";
					}

					$values = [
						"driver" => $this->target["driver"],
						"server" => $this->target["server"],
						"username" => $this->target["username"],
						"db" => $this->target["database"],
					];

					if (!array_key_exists($name, $values)) {
						return $heading . $value . "\n";
					}

					$display = $name === "driver" && $values[$name] === "server"
						? "MySQL / MariaDB"
						: $values[$name];

					return $heading
						. '<input value="' . h($display) . '" readonly autocapitalize="off">'
						. '<input type="hidden" name="auth[' . h($name) . ']" value="' . h($values[$name]) . '">'
						. "\n";
				}
			}
		}

		$plugins = [];
		foreach (glob("plugins-enabled/*.php") as $plugin) {
			$plugins[] = require($plugin);
		}
		$plugins[] = new LockedTargetPlugin(target());

		return new \Adminer\Plugins($plugins);
	}
}

namespace {
	\PloydokAdminer\bootstrap_request();

	if (basename($_SERVER["DOCUMENT_URI"] ?? $_SERVER["REQUEST_URI"]) === "adminer.css" && is_readable("adminer.css")) {
		header("Content-Type: text/css");
		readfile("adminer.css");
		exit;
	}

	function adminer_object() {
		return \PloydokAdminer\adminer_object();
	}

	require("adminer.php");
}
