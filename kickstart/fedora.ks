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
# Install ansible after as it's not a part of the ISO's core packages. Then run it
dnf install -y ansible git
ansible-pull -U https://github.com/justin8/home-cluster.git ansible/playbook.yml -i ansible/inventory

# Configure login screen to show IP address
cat > /etc/issue << EOF
Fedora Linux \r (\l)
IP Address: \4
EOF
%end