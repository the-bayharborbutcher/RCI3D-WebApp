#!/bin/bash
# ================================================
# RCI3D — Setup Mosquitto WSS (WebSocket Secure)
# Run on Raspberry Pi : bash setup_wss.sh
# ================================================

echo "=== Generating self-signed SSL certificate ==="
sudo mkdir -p /etc/mosquitto/certs
cd /etc/mosquitto/certs

# Generate CA key + cert
sudo openssl genrsa -out ca.key 2048
sudo openssl req -new -x509 -days 3650 -key ca.key -out ca.crt \
  -subj "/C=TN/ST=Tunis/L=Tunis/O=RCI3D/CN=RCI3D-CA"

# Generate server key + cert signed by CA
sudo openssl genrsa -out server.key 2048
sudo openssl req -new -key server.key -out server.csr \
  -subj "/C=TN/ST=Tunis/L=Tunis/O=RCI3D/CN=10.29.43.197"
sudo openssl x509 -req -days 3650 -in server.csr \
  -CA ca.crt -CAkey ca.key -CAcreateserial -out server.crt

sudo chmod 644 /etc/mosquitto/certs/*
echo "=== Certificates generated ==="
ls -la /etc/mosquitto/certs/
