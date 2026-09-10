"""
build_insitu_sqlite.py - Convert 500MB Copernicus In-Situ CSV into an indexed SQLite database.

Creates:
  data/insitu_currents.sqlite with table `insitu_currents` and indexes on (latitude, longitude) and (timestamp_epoch).
"""

import os
import sys
import sqlite3
import logging
from datetime import datetime, timezone

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

# Add current dir to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from insitu_currents import find_insitu_csv_path


def parse_iso_epoch(time_str: str) -> float:
    try:
        clean = time_str.strip().replace("Z", "+00:00")
        dt = datetime.fromisoformat(clean)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.timestamp()
    except Exception:
        return 0.0


def build_sqlite_from_csv(csv_path: str, sqlite_output_path: str):
    logger.info(f"Source CSV: {csv_path}")
    logger.info(f"Target SQLite: {sqlite_output_path}")

    if os.path.exists(sqlite_output_path):
        logger.info(f"Removing existing SQLite database: {sqlite_output_path}")
        os.remove(sqlite_output_path)

    conn = sqlite3.connect(sqlite_output_path)
    cursor = conn.cursor()

    # Create table
    cursor.execute("""
        CREATE TABLE insitu_currents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            platform_id TEXT,
            time_str TEXT,
            timestamp_epoch REAL,
            latitude REAL,
            longitude REAL,
            depth REAL,
            u_ms REAL,
            v_ms REAL
        )
    """)

    # Stream CSV and pair EWCT / NSCT
    ewct_dict = {}  # (pid, time_str, depth) -> (lat, lon, val)
    nsct_dict = {}

    batch = []
    inserted_count = 0

    logger.info("Reading CSV and pairing EWCT / NSCT components...")
    with open(csv_path, mode="r", encoding="utf-8", errors="ignore") as f:
        for line_idx, line in enumerate(f):
            if line_idx == 0:
                continue
            if line_idx % 500000 == 0:
                logger.info(f"Processed {line_idx:,} CSV lines...")

            parts = line.strip().split(",")
            if len(parts) < 10:
                continue

            var = parts[0].strip()
            if var not in ("EWCT", "NSCT"):
                continue

            try:
                lat = float(parts[5])
                lon = float(parts[4])
                depth = float(parts[6]) if len(parts) > 6 and parts[6] else 0.0
                if depth > 20.0:  # Only index near-surface records (<20m) for fast disk footprint
                    continue
                time_raw = parts[3].strip()
                val = float(parts[9])
                pid = parts[1].strip()
            except (ValueError, IndexError):
                continue

            key = (pid, time_raw, round(depth, 1))

            if var == "EWCT":
                if key in nsct_dict:
                    ns_val, n_lat, n_lon = nsct_dict.pop(key)
                    epoch = parse_iso_epoch(time_raw)
                    batch.append((pid, time_raw, epoch, (lat + n_lat) / 2.0, (lon + n_lon) / 2.0, depth, val, ns_val))
                else:
                    ewct_dict[key] = (val, lat, lon)
            else:
                if key in ewct_dict:
                    ew_val, e_lat, e_lon = ewct_dict.pop(key)
                    epoch = parse_iso_epoch(time_raw)
                    batch.append((pid, time_raw, epoch, (e_lat + lat) / 2.0, (e_lon + lon) / 2.0, depth, ew_val, val))
                else:
                    nsct_dict[key] = (val, lat, lon)

            if len(batch) >= 20000:
                cursor.executemany("""
                    INSERT INTO insitu_currents (platform_id, time_str, timestamp_epoch, latitude, longitude, depth, u_ms, v_ms)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, batch)
                conn.commit()
                inserted_count += len(batch)
                batch.clear()

    if batch:
        cursor.executemany("""
            INSERT INTO insitu_currents (platform_id, time_str, timestamp_epoch, latitude, longitude, depth, u_ms, v_ms)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, batch)
        conn.commit()
        inserted_count += len(batch)

    logger.info(f"Inserted {inserted_count:,} paired velocity records. Building indexes...")

    cursor.execute("CREATE INDEX idx_spatial ON insitu_currents (latitude, longitude)")
    cursor.execute("CREATE INDEX idx_time ON insitu_currents (timestamp_epoch)")
    cursor.execute("CREATE INDEX idx_depth ON insitu_currents (depth)")
    conn.commit()
    conn.close()

    logger.info(f"SQLite database created successfully at: {sqlite_output_path}")


if __name__ == "__main__":
    csv = find_insitu_csv_path()
    if not csv:
        print("Error: Could not find in-situ CSV in data/ directories.")
        sys.exit(1)
    target_db = os.path.join(os.path.dirname(csv), "insitu_currents.sqlite")
    build_sqlite_from_csv(csv, target_db)