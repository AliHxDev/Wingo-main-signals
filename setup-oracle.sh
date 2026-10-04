#!/usr/bin/env bash
# ==============================================================================
# WinGo WhatsApp Prediction Bot - Oracle Cloud Always Free 1-Click Installer
# OS Support: Ubuntu 20.04 / 22.04 / 24.04 LTS (x86_64 or ARM64 Ampere)
# ==============================================================================

set -e
export DEBIAN_FRONTEND=noninteractive

echo "=========================================================="
echo "🚀 Installing WinGo WhatsApp Bot on Oracle Cloud Always Free"
echo "=========================================================="

# 1. Update system packages non-interactively
echo "📦 Updating system packages..."
sudo apt-get update -y
sudo apt-get install -y curl wget git build-essential ufw iptables iptables-persistent netfilter-persistent

# 2. Prevent OOM Killer: Ensure at least 2GB Swap on low-RAM VPS instances
SWAP_EXISTS=$(free -m | awk '/^Swap:/{print $2}')
if [ -z "$SWAP_EXISTS" ] || [ "$SWAP_EXISTS" -lt 1024 ]; then
    echo "🧠 Low RAM instance detected. Setting up 2GB Swap to prevent build memory errors..."
    sudo swapoff -a 2>/dev/null || true
    sudo fallocate -l 2G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    if ! grep -q '/swapfile' /etc/fstab; then
        echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
    fi
    echo "✅ 2GB Swap activated successfully."
fi

# 3. Install Node.js 20 LTS (Supports both AMD64 and ARM64 Ampere)
if ! command -v node &> /dev/null || [[ $(node -v | cut -d'.' -f1 | sed 's/v//') -lt 20 ]]; then
    echo "🟢 Installing Node.js 20 LTS..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi
echo "✅ Node.js $(node -v) & npm $(npm -v) installed."

# 4. Install PM2 process manager
if ! command -v pm2 &> /dev/null; then
    echo "🟢 Installing PM2 globally..."
    sudo npm install -g pm2
fi

# 5. Prepare local persistent data storage (Oracle Self-Contained)
echo "📁 Setting up local persistent data storage..."
mkdir -p data
mkdir -p auth_info_baileys

# 6. Configure .env file
JWT_SECRET=$(openssl rand -hex 16 2>/dev/null || echo "wingo-jwt-secret-$(date +%s)")
ADMIN_PASS="admin123456"

if [ ! -f .env ]; then
    echo "📝 Creating .env configuration file..."
    cat <<EOF > .env
PORT=3000
NODE_ENV=production
USE_LOCAL_DB=true
DATABASE_URL=
DATABASE_SSL=false
ADMIN_USERNAME=admin
ADMIN_PASSWORD=${ADMIN_PASS}
JWT_SECRET=${JWT_SECRET}
EOF
    echo "✅ .env created with Oracle Native Local Persistent Engine."
else
    echo "ℹ️  Existing .env found. Ensuring local persistent engine is enabled..."
    if grep -q "USE_LOCAL_DB" .env; then
        sed -i 's/USE_LOCAL_DB=.*/USE_LOCAL_DB=true/' .env
    else
        echo "USE_LOCAL_DB=true" >> .env
    fi
    sed -i 's/^DATABASE_URL=.*/DATABASE_URL=/' .env || true
fi

# 7. Oracle Cloud Firewall Configuration (Crucial for OCI!)
echo "🛡️ Opening Port 3000 in Oracle Cloud Ubuntu Firewall..."
sudo iptables -I INPUT 1 -p tcp --dport 22 -j ACCEPT 2>/dev/null || true
sudo iptables -I INPUT 1 -p tcp --dport 3000 -j ACCEPT 2>/dev/null || true
sudo iptables -I INPUT 1 -p tcp --dport 80 -j ACCEPT 2>/dev/null || true
sudo iptables -I INPUT 1 -p tcp --dport 443 -j ACCEPT 2>/dev/null || true
sudo netfilter-persistent save 2>/dev/null || sudo /etc/init.d/netfilter-persistent save 2>/dev/null || true

if command -v ufw &> /dev/null; then
    sudo ufw allow 22/tcp 2>/dev/null || true
    sudo ufw allow 3000/tcp 2>/dev/null || true
    sudo ufw allow 80/tcp 2>/dev/null || true
    sudo ufw allow 443/tcp 2>/dev/null || true
    sudo ufw --force enable 2>/dev/null || true
fi

# 8. Install dependencies & Build
echo "🔨 Installing application dependencies..."
npm install --legacy-peer-deps

echo "⚡ Building production frontend and server bundle..."
npm run build

# 9. Start with PM2 (24/7 background runner with auto-restart)
echo "🚀 Starting WinGo WhatsApp Bot with PM2..."
pm2 delete wingo-whatsapp-bot 2>/dev/null || true
pm2 start ecosystem.config.cjs
pm2 save
# Ensure systemd auto-start on VPS boot
pm2 startup systemd -u $USER --hp $HOME 2>/dev/null || true

# Get public IP
PUBLIC_IP=$(curl -s https://ifconfig.me || curl -s https://api.ipify.org || curl -s https://icanhazip.com || echo "YOUR_INSTANCE_IP")

echo ""
echo "=========================================================="
echo "🎉 WinGo WhatsApp Bot is RUNNING 24/7 on Oracle Cloud!"
echo "=========================================================="
echo ""
echo "🌐 Access your Web Dashboard:"
echo "   http://${PUBLIC_IP}:3000"
echo ""
echo "🔑 Default Credentials:"
echo "   Username: admin"
echo "   Password: admin123456"
echo ""
echo "📋 Management Commands:"
echo "   pm2 status                    # View bot status"
echo "   pm2 logs wingo-whatsapp-bot   # View live real-time logs"
echo "   pm2 restart wingo-whatsapp-bot # Restart bot"
echo "   pm2 stop wingo-whatsapp-bot   # Stop bot"
echo ""
echo "⚠️  CRITICAL STEP FOR ORACLE CLOUD (VCN Ingress Rule):"
echo "   To access http://${PUBLIC_IP}:3000 from your phone/PC browser,"
echo "   you MUST allow Port 3000 in the Oracle Cloud Console:"
echo "   1. Go to Networking > Virtual Cloud Networks > your VCN"
echo "   2. Click 'Default Security List for...'"
echo "   3. Click 'Add Ingress Rules'"
echo "   4. Source CIDR: 0.0.0.0/0"
echo "   5. IP Protocol: TCP"
echo "   6. Destination Port Range: 3000"
echo "   7. Click 'Add Ingress Rules'"
echo "=========================================================="
