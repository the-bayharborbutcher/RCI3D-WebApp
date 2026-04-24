#!/usr/bin/env python3
# ============================================================
# RCI3D — Bridge MQTT + Notifications Telegram
# Raspberry Pi 10.29.43.197
# Bot Telegram : @RCI3DSTUDIOBot
# ============================================================
import paho.mqtt.client as mqtt
import requests
import json
import time
import logging
from datetime import datetime

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [RCI3D Bridge] %(message)s'
)
log = logging.getLogger(__name__)

# ╔══════════════════════════════════════════════════════════╗
# ║                   CONFIGURATION                          ║
# ╚══════════════════════════════════════════════════════════╝

# ── OctoPrint ───────────────────────────────────────────────
OCTOPRINT_URL = "http://localhost"
API_KEY       = "BpbADLDMF8XRhrOKwhGmPa6by0oAhjOUH6MGMZbOH88"

# ── MQTT Mosquitto ───────────────────────────────────────────
MQTT_HOST     = "localhost"
MQTT_PORT     = 1883
MQTT_USER     = "rci3duser"
MQTT_PASS     = "mqttuser"
MQTT_TOPIC    = "octoPrint"
POLL_INTERVAL = 5

# ── Telegram ─────────────────────────────────────────────────
TELEGRAM_TOKEN   = "7690379310:AAG3wImt3j8SRAek8YszqdtJiBDjKxDxjes"
TELEGRAM_CHAT_ID = "6899744508"
TELEGRAM_API     = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}"

# ── Seuils alertes ───────────────────────────────────────────
TEMP_ALERT_THRESHOLD = 10    # °C au-dessus de la cible
TEMP_ALERT_COOLDOWN  = 120   # secondes entre 2 alertes

# ╔══════════════════════════════════════════════════════════╗
# ║                FONCTIONS TELEGRAM                        ║
# ╚══════════════════════════════════════════════════════════╝

def send_telegram(message, silent=False):
    try:
        r = requests.post(
            f"{TELEGRAM_API}/sendMessage",
            json={
                "chat_id":              TELEGRAM_CHAT_ID,
                "text":                 message,
                "parse_mode":           "HTML",
                "disable_notification": silent
            },
            timeout=10
        )
        if r.ok:
            log.info("Telegram: message envoyé ✅")
        else:
            log.warning(f"Telegram erreur: {r.text}")
    except Exception as e:
        log.error(f"Telegram exception: {e}")

def fmt_duration(seconds):
    if not seconds or seconds <= 0:
        return "--"
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    return f"{h}h {m:02d}min" if h > 0 else f"{m}min"

def now_str():
    return datetime.now().strftime("%d/%m/%Y à %H:%M")

# ╔══════════════════════════════════════════════════════════╗
# ║              FONCTIONS OCTOPRINT API                     ║
# ╚══════════════════════════════════════════════════════════╝

HEADERS = {"X-Api-Key": API_KEY, "Content-Type": "application/json"}

def get_printer():
    try:
        r = requests.get(f"{OCTOPRINT_URL}/api/printer", headers=HEADERS, timeout=3)
        return r.json() if r.ok else None
    except Exception as e:
        log.warning(f"OctoPrint unreachable: {e}")
        return None

def get_job():
    try:
        r = requests.get(f"{OCTOPRINT_URL}/api/job", headers=HEADERS, timeout=3)
        return r.json() if r.ok else None
    except Exception as e:
        log.warning(f"Job API error: {e}")
        return None

# ╔══════════════════════════════════════════════════════════╗
# ║                    ÉTAT INTERNE                          ║
# ╚══════════════════════════════════════════════════════════╝

_last_file        = None
_print_start_time = None
_temp_alert_sent  = 0

# ╔══════════════════════════════════════════════════════════╗
# ║              CALLBACKS MQTT                              ║
# ╚══════════════════════════════════════════════════════════╝

def on_connect(client, userdata, flags, rc):
    if rc == 0:
        log.info("Connecté au broker Mosquitto ✅")
        client.subscribe(f"{MQTT_TOPIC}/command")
        client.subscribe(f"{MQTT_TOPIC}/job/command")
        client.subscribe(f"{MQTT_TOPIC}/event/+")
    else:
        log.error(f"Connexion MQTT échouée rc={rc}")

def on_message(client, userdata, msg):
    topic   = msg.topic
    payload = msg.payload.decode()

    if topic == f"{MQTT_TOPIC}/command":
        try:
            cmd = json.loads(payload)
        except:
            cmd = {"command": payload}
        requests.post(f"{OCTOPRINT_URL}/api/printer/command",
                      headers=HEADERS, json=cmd, timeout=3)

    elif topic == f"{MQTT_TOPIC}/job/command":
        try:
            requests.post(f"{OCTOPRINT_URL}/api/job",
                          headers=HEADERS, json=json.loads(payload), timeout=3)
        except Exception as e:
            log.error(f"Job command error: {e}")

    elif topic.startswith(f"{MQTT_TOPIC}/event/"):
        handle_event(topic, payload)

def handle_event(topic, payload):
    global _last_file, _print_start_time
    event = topic.split("/event/")[-1]
    try:
        data = json.loads(payload)
    except:
        data = {}
    fname = data.get("name", "Fichier inconnu")

    if event == "PrintStarted":
        _last_file        = fname
        _print_start_time = time.time()
        job = get_job()
        eta = "--"
        if job:
            eta = fmt_duration(job.get("job", {}).get("estimatedPrintTime"))
        send_telegram(
            f"🖨️ <b>Impression démarrée !</b>\n\n"
            f"📄 <b>Fichier :</b> {fname}\n"
            f"⏱️ <b>Durée estimée :</b> {eta}\n"
            f"📅 {now_str()}"
        )

    elif event == "PrintDone":
        dur = fmt_duration(time.time() - _print_start_time) if _print_start_time else "--"
        _print_start_time = None
        send_telegram(
            f"✅ <b>Impression terminée !</b>\n\n"
            f"📄 <b>Fichier :</b> {_last_file or fname}\n"
            f"⏱️ <b>Durée :</b> {dur}\n"
            f"📅 {now_str()}\n\n"
            f"🎉 Votre pièce est prête !"
        )
        _last_file = None

    elif event == "PrintFailed":
        dur = fmt_duration(time.time() - _print_start_time) if _print_start_time else "--"
        _print_start_time = None
        send_telegram(
            f"❌ <b>IMPRESSION ÉCHOUÉE !</b>\n\n"
            f"📄 <b>Fichier :</b> {_last_file or fname}\n"
            f"⚠️ <b>Raison :</b> {data.get('reason', 'inconnue')}\n"
            f"⏱️ <b>Après :</b> {dur}\n"
            f"📅 {now_str()}\n\n"
            f"🔧 Vérifiez l'imprimante immédiatement !"
        )
        _last_file = None

    elif event == "PrintCancelled":
        dur = fmt_duration(time.time() - _print_start_time) if _print_start_time else "--"
        _print_start_time = None
        send_telegram(
            f"⏹️ <b>Impression annulée</b>\n\n"
            f"📄 <b>Fichier :</b> {_last_file or fname}\n"
            f"⏱️ <b>Après :</b> {dur}\n"
            f"📅 {now_str()}",
            silent=True
        )
        _last_file = None

    elif event == "PrintPaused":
        send_telegram(
            f"⏸️ <b>Impression en pause</b>\n\n"
            f"📄 <b>Fichier :</b> {_last_file or fname}\n"
            f"📅 {now_str()}",
            silent=True
        )

    elif event == "PrintResumed":
        send_telegram(
            f"▶️ <b>Impression reprise</b>\n\n"
            f"📄 <b>Fichier :</b> {_last_file or fname}\n"
            f"📅 {now_str()}",
            silent=True
        )

    elif event == "Error":
        send_telegram(
            f"🚨 <b>ERREUR OctoPrint</b>\n\n"
            f"⚠️ {data.get('error', 'erreur inconnue')}\n"
            f"📅 {now_str()}"
        )

def on_disconnect(client, userdata, rc):
    log.warning(f"MQTT déconnecté rc={rc} — reconnexion automatique...")

# ╔══════════════════════════════════════════════════════════╗
# ║               SURVEILLANCE TEMPÉRATURE                   ║
# ╚══════════════════════════════════════════════════════════╝

def check_temp_alert(temps):
    global _temp_alert_sent
    now = time.time()
    if now - _temp_alert_sent < TEMP_ALERT_COOLDOWN:
        return
    for sensor, data in temps.items():
        if not isinstance(data, dict):
            continue
        actual = data.get("actual", 0)
        target = data.get("target", 0)
        if target > 0 and actual > target + TEMP_ALERT_THRESHOLD:
            _temp_alert_sent = now
            name = "Buse (Hotend)" if "tool" in sensor else "Plateau (Bed)"
            send_telegram(
                f"🌡️ <b>ALERTE TEMPÉRATURE !</b>\n\n"
                f"🔥 <b>Capteur :</b> {name}\n"
                f"📊 <b>Actuelle :</b> {actual:.1f}°C\n"
                f"🎯 <b>Cible :</b> {target:.1f}°C\n"
                f"⚠️ Dépassement de +{actual - target:.1f}°C\n"
                f"📅 {now_str()}"
            )
            break

# ╔══════════════════════════════════════════════════════════╗
# ║                   BOUCLE PRINCIPALE                      ║
# ╚══════════════════════════════════════════════════════════╝

def main():
    log.info("Démarrage RCI3D Bridge...")

    # Message de démarrage Telegram
    send_telegram(
        f"🚀 <b>RCI3D Studio — Bridge démarré</b>\n\n"
        f"🖥️ <b>Pi :</b> 10.29.43.197\n"
        f"📡 <b>MQTT :</b> {MQTT_HOST}:{MQTT_PORT}\n"
        f"🖨️ <b>OctoPrint :</b> {OCTOPRINT_URL}\n"
        f"📅 {now_str()}\n\n"
        f"✅ Notifications actives !",
        silent=True
    )

    # Connexion MQTT
    client = mqtt.Client(client_id="rci3d_bridge_telegram")
    client.username_pw_set(MQTT_USER, MQTT_PASS)
    client.on_connect    = on_connect
    client.on_message    = on_message
    client.on_disconnect = on_disconnect
    client.reconnect_delay_set(min_delay=1, max_delay=30)

    try:
        client.connect(MQTT_HOST, MQTT_PORT, keepalive=60)
    except Exception as e:
        log.error(f"Impossible de connecter au broker: {e}")
        send_telegram(f"❌ <b>Bridge: connexion MQTT échouée</b>\n⚠️ {e}")
        return

    client.loop_start()
    log.info(f"Bridge actif — polling OctoPrint toutes les {POLL_INTERVAL}s")

    while True:
        printer_data = get_printer()
        job_data     = get_job()

        if printer_data:
            temps = printer_data.get("temperature", {})
            # Publier températures en JSON (format mqtt.js)
            for sensor, data in temps.items():
                if isinstance(data, dict):
                    payload = json.dumps({
                        "actual":     round(data.get("actual", 0), 1),
                        "target":     round(data.get("target", 0), 1),
                        "_timestamp": int(time.time())
                    })
                    client.publish(f"{MQTT_TOPIC}/temperature/{sensor}", payload)
            # Vérifier alertes température
            check_temp_alert(temps)

        if job_data:
            progress = job_data.get("progress", {})
            pct      = progress.get("completion") or 0
            fname    = job_data.get("job", {}).get("file", {}).get("name", "")
            client.publish(f"{MQTT_TOPIC}/progress/printing", json.dumps({
                "progress":   round(pct, 1),
                "path":       fname,
                "_timestamp": int(time.time())
            }))

        time.sleep(POLL_INTERVAL)

if __name__ == "__main__":
    main()
