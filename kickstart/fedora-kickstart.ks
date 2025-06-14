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
bootloader --location=mbr --boot-drive=sda
# Clear the Master Boot Record
zerombr
# Partition clearing information
clearpart --all --initlabel --drives=sda
# Disk partitioning information
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
chmod 700 /root/.ssh
chmod 600 /root/.ssh/authorized_keys

# Configure SSH to allow root login with key
sed -i 's/#PermitRootLogin prohibit-password/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
%end