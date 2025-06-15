# System language
lang en_US.UTF-8
# Keyboard layouts
keyboard us
# Enable network
network --bootproto=dhcp --device=link --activate
# System timezone
timezone UTC --utc
# Root password (locked by default, using SSH key auth)
rootpw --lock
# System services
services --enabled="sshd,chronyd"
# System bootloader configuration
bootloader --location=mbr --boot-drive=sda --timeout=1
# Clear the Master Boot Record
zerombr
# Partition clearing information
clearpart --all --initlabel --drives=sda
# Disk partitioning information
part biosboot --fstype="biosboot" --size=1 --ondisk=sda
part /boot --fstype="xfs" --size=1024 --ondisk=sda
part / --fstype="xfs" --grow --ondisk=sda

# Reboot after installation
reboot

%packages
@core
openssh-server
%end

%post
# Enable SSH root login with key
mkdir -p /root/.ssh
echo "ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBF88ymIneFCORv9MOMjHDWD5dswKXM/nbRNtuUP3uS0Icu0ROvWKjP6JWow2PCERWx6YVQV7adzzqUhI1K18W8Q= justin@hades" > /root/.ssh/authorized_keys
echo "ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBDVritj4bQDwofH/hgzNmYjOAjufpgL4K28n+ppRu77ylDHAl8Jb6/hN/qC+wGR64a34r0csFaxTzXmrO+0djxs= justin@hestia" >> /root/.ssh/authorized_keys
echo "ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBMFBv5hR9yKLqpZ815Vn+iGDAxW7Zk3Iwg5VTsw3A10hC5+fYNaZUjFi8FxcaQfqYyuFmtBsIxMa1e7gADSIJC0= justindray@hephaestus" >> /root/.ssh/authorized_keys
chmod 700 /root/.ssh
chmod 600 /root/.ssh/authorized_keys

# Configure SSH to allow root login with key
sed -i 's/#PermitRootLogin prohibit-password/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config

# Install ansible after as it's not a part of the ISO's core packages
dnf install -y ansible

# Configure login screen to show IP address
cat > /etc/issue << EOF
Fedora Linux \r (\l)
IP Address: \4
EOF
%end