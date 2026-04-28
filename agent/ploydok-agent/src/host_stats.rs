// SPDX-License-Identifier: AGPL-3.0-only
//
// Host VPS monitoring (Sprint 6.6).
// Reads /proc/{stat,meminfo,loadavg,uptime} et fait un statvfs sur /.
// Aucun new dep lourd : libc::statvfs + lectures fichiers.

use ploydok_proto::HostStatsResponse;
use std::ffi::CString;
use std::fs;
use std::time::Duration;
use tokio::time::sleep;

/// Lit le snapshot complet host stats. Best-effort : si une lecture échoue,
/// le champ correspondant reste à 0 et `error` accumule les messages.
pub async fn read_host_stats() -> HostStatsResponse {
    let mut errs: Vec<String> = Vec::new();

    // CPU % : delta sur 100 ms.
    let cpu_percent = match sample_cpu().await {
        Ok(v) => v,
        Err(e) => {
            errs.push(format!("cpu:{e}"));
            0.0
        }
    };

    let (mem_total, mem_avail, swap_total, swap_used) = match read_meminfo() {
        Ok(v) => v,
        Err(e) => {
            errs.push(format!("mem:{e}"));
            (0, 0, 0, 0)
        }
    };
    let mem_used = mem_total.saturating_sub(mem_avail);

    let (load_1, load_5, load_15) = read_loadavg().unwrap_or_else(|e| {
        errs.push(format!("load:{e}"));
        (0.0, 0.0, 0.0)
    });

    let (disk_total, disk_free, disk_used, inodes_total, inodes_used) = match statvfs_root() {
        Ok(v) => v,
        Err(e) => {
            errs.push(format!("disk:{e}"));
            (0, 0, 0, 0, 0)
        }
    };

    let cpu_count = num_cpus_from_proc().unwrap_or(0);
    let uptime_seconds = read_uptime().unwrap_or(0);

    HostStatsResponse {
        cpu_percent,
        mem_total_bytes: mem_total,
        mem_used_bytes: mem_used,
        mem_available_bytes: mem_avail,
        swap_total_bytes: swap_total,
        swap_used_bytes: swap_used,
        load_1,
        load_5,
        load_15,
        disk_total_bytes: disk_total,
        disk_used_bytes: disk_used,
        disk_free_bytes: disk_free,
        inodes_total,
        inodes_used,
        cpu_count,
        uptime_seconds,
        error: errs.join(";"),
    }
}

// ────────────────────────────────────────────────────────────────────────────
// CPU sampling (/proc/stat delta)
// ────────────────────────────────────────────────────────────────────────────

async fn sample_cpu() -> Result<f64, String> {
    let (idle1, total1) = read_cpu_jiffies()?;
    sleep(Duration::from_millis(100)).await;
    let (idle2, total2) = read_cpu_jiffies()?;
    let didle = idle2.saturating_sub(idle1) as f64;
    let dtotal = total2.saturating_sub(total1) as f64;
    if dtotal <= 0.0 {
        return Ok(0.0);
    }
    Ok(((dtotal - didle) / dtotal) * 100.0)
}

fn read_cpu_jiffies() -> Result<(u64, u64), String> {
    let s = fs::read_to_string("/proc/stat").map_err(|e| e.to_string())?;
    let line = s
        .lines()
        .next()
        .ok_or_else(|| "empty /proc/stat".to_string())?;
    // Format: "cpu  user nice system idle iowait irq softirq steal guest guest_nice"
    let mut iter = line.split_whitespace();
    iter.next(); // skip "cpu"
    let vals: Vec<u64> = iter.filter_map(|v| v.parse().ok()).collect();
    if vals.len() < 4 {
        return Err("/proc/stat malformed".to_string());
    }
    let idle = vals[3] + vals.get(4).copied().unwrap_or(0); // idle + iowait
    let total: u64 = vals.iter().sum();
    Ok((idle, total))
}

// ────────────────────────────────────────────────────────────────────────────
// Memory (/proc/meminfo)
// ────────────────────────────────────────────────────────────────────────────

fn read_meminfo() -> Result<(u64, u64, u64, u64), String> {
    let s = fs::read_to_string("/proc/meminfo").map_err(|e| e.to_string())?;
    let mut total = 0u64;
    let mut avail = 0u64;
    let mut swap_total = 0u64;
    let mut swap_free = 0u64;
    for line in s.lines() {
        let (k, v) = match line.split_once(':') {
            Some(p) => p,
            None => continue,
        };
        let kb: u64 = v
            .split_whitespace()
            .next()
            .unwrap_or("0")
            .parse()
            .unwrap_or(0);
        match k {
            "MemTotal" => total = kb * 1024,
            "MemAvailable" => avail = kb * 1024,
            "SwapTotal" => swap_total = kb * 1024,
            "SwapFree" => swap_free = kb * 1024,
            _ => {}
        }
    }
    let swap_used = swap_total.saturating_sub(swap_free);
    Ok((total, avail, swap_total, swap_used))
}

// ────────────────────────────────────────────────────────────────────────────
// Load avg (/proc/loadavg)
// ────────────────────────────────────────────────────────────────────────────

fn read_loadavg() -> Result<(f64, f64, f64), String> {
    let s = fs::read_to_string("/proc/loadavg").map_err(|e| e.to_string())?;
    let parts: Vec<&str> = s.split_whitespace().collect();
    if parts.len() < 3 {
        return Err("malformed".to_string());
    }
    let l1 = parts[0].parse().unwrap_or(0.0);
    let l5 = parts[1].parse().unwrap_or(0.0);
    let l15 = parts[2].parse().unwrap_or(0.0);
    Ok((l1, l5, l15))
}

// ────────────────────────────────────────────────────────────────────────────
// Disk usage / inodes (statvfs sur /)
// ────────────────────────────────────────────────────────────────────────────

fn statvfs_root() -> Result<(u64, u64, u64, u64, u64), String> {
    let path = CString::new("/").map_err(|e| e.to_string())?;
    let mut stat: libc::statvfs = unsafe { std::mem::zeroed() };
    let ret = unsafe { libc::statvfs(path.as_ptr(), &mut stat) };
    if ret != 0 {
        return Err(format!(
            "statvfs failed: {}",
            std::io::Error::last_os_error()
        ));
    }
    let block_size = stat.f_frsize as u64;
    let total = stat.f_blocks as u64 * block_size;
    let free = stat.f_bavail as u64 * block_size;
    let used = total.saturating_sub(free);
    let inodes_total = stat.f_files as u64;
    let inodes_used = inodes_total.saturating_sub(stat.f_favail as u64);
    Ok((total, free, used, inodes_total, inodes_used))
}

// ────────────────────────────────────────────────────────────────────────────
// CPU count + uptime
// ────────────────────────────────────────────────────────────────────────────

fn num_cpus_from_proc() -> Result<u32, String> {
    let s = fs::read_to_string("/proc/cpuinfo").map_err(|e| e.to_string())?;
    let n = s.lines().filter(|l| l.starts_with("processor")).count();
    Ok(n as u32)
}

fn read_uptime() -> Result<u64, String> {
    let s = fs::read_to_string("/proc/uptime").map_err(|e| e.to_string())?;
    let first = s.split_whitespace().next().unwrap_or("0");
    let secs: f64 = first.parse().unwrap_or(0.0);
    Ok(secs as u64)
}
