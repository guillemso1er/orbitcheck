# Ansible

## Run conainer for testing locally

```
ansible-playbook container.yml
```


## VPS Details


*   **OS**: Red Hat-based Linux (e.g., Fedora, CentOS Stream) using DNF package manager.
*   **Users**:
    *   `adminuser`: Sudo-capable administrator with specific, limited, passwordless permissions.
    *   `podman_user`: Unprivileged user (UID 1001) for running rootless containers.

### Final State

*   **Security**:
    *   **SSH**: Hardened; root login and password authentication are disabled.
    *   **Firewall**: `firewalld` is active, allowing SSH, HTTP/S, and port 9091/tcp while blocking risky ports like RDP.
    *   **Intrusion Prevention**: `fail2ban` is installed with custom jails for Podman and web authentication.
    *   **SELinux**: Enforced, with custom policies and contexts specifically for rootless Podman storage and operations.
    *   **Updates**: Automatic security updates are enabled via `dnf-automatic`.
    *   **Logging**: `journald` is configured for persistent logs.

*   **Storage & Folders**:
    *   A second data disk is automatically discovered, partitioned (XFS), and mounted at `%h`.
    *   Container storage (`graphroot`) is located at `%h/storage`.
    *   Podman-related data is organized in subdirectories: `%h/{volumes,compose,configs,logs}`.
    *   All container-related directories are owned by the `podman_user` with correct SELinux contexts and inheritable permissions (ACLs).

*   **Services & Applications**:
    *   **Podman**: Configured for rootless operation by `podman_user`. Its API is managed by a user-level systemd socket (`podman.socket`), and lingering is enabled for the user to allow services to run after logout.
    *   **Automatic Backups**: A cron job runs as `podman_user` to execute a script that archives critical paths (container data, `/etc` files) and uploads them to cloud storage (Mega) using `rclone`.

### Key Automation Features & Capabilities

*   **Idempotent & Tagged Execution**: The playbook is designed to be run multiple times safely. Specific operations like `backup` and `restore` can be triggered using Ansible tags.
*   **Secrets Management**: Sensitive data (like `ghcr_token` for a container registry and rclone credentials) is expected in an encrypted `vars/secrets.yml` file and handled securely (e.g., passed via `stdin` to Podman secrets).
*   **Full Backup & Restore Workflow**: Beyond automatic backups, the playbook includes a comprehensive, manually-triggered restore process. This workflow stops services, downloads a specific backup, cleans container storage, unarchives the data, and correctly reapplies all file ownership and SELinux contexts before restarting services.
*   **Granular Sudo Permissions**: The `adminuser` does not have full, passwordless sudo. A precise `sudoers` rule is created to only allow specific commands needed for deployment and container management without a password, enhancing security.
*   **Pre-Reboot Safety Checks**: Before the final reboot, the playbook runs a series of critical checks to ensure the server will be accessible, verifying SSH configuration, firewall rules, and the existence of SSH keys to prevent being locked out.


This Ansible playbook automates the complete setup and hardening of a server, focusing on running rootless containers with Podman. It's divided into an initial bootstrap phase followed by a comprehensive configuration phase.

### Play 1: Initial Server Bootstrap (as `root`)

This play performs the first-time setup to make the server securely accessible.
*   **User Creation**: Creates a primary administrator user (`admin_user`) with a hashed password and adds them to the `wheel` (sudo) group.
*   **SSH Access**: Sets up an SSH authorized key for the `admin_user`, allowing for passwordless login.
*   **Sudo Configuration**:
    *   Removes default `cloud-init` sudo rules.
    *   Creates a specific, locked-down sudoers file for the `admin_user` that:
        *   Disables the TTY requirement, which is essential for automation and CI/CD pipelines.
        *   Allows the `admin_user` to run a specific list of deployment-related commands (like `rsync`, `chown`, `rm`) as `root` without a password.
        *   Allows the `admin_user` to run any command as the `podman_user` without a password, enabling seamless management of the container environment.

### Play 2: Main Server Configuration (as `admin_user`)

This is the core play that configures the entire system using the newly created admin user with `sudo`.

#### **System & User Preparation**
*   **Podman User**: Creates a dedicated, non-root user (`podman_user`) with a static UID for running containers. This user is added to the `systemd-journal` group to access logs.
*   **Sub-UID/GID Mapping**: Configures `/etc/subuid` and `/etc/subgid` to allocate a range of user IDs for the `podman_user`, a requirement for rootless containers.
*   **Package Installation**:
    *   Adds the EPEL and Infisical repositories.
    *   Installs a comprehensive list of necessary packages, including `podman`, `podman-compose`, `podman-quadlet`, `firewalld`, `fail2ban`, `dnf-automatic`, and SELinux tools.
*   **Storage Setup (Optional)**: If a second data disk is specified (`use_second_data_disk: true`), it:
    *   Formats the disk with the XFS filesystem.
    *   Mounts it to the primary container storage path (`container_base_path`).
    *   Adds an entry to `/etc/fstab` to make the mount persistent across reboots.
    *   Enables `fstrim.timer` for SSD maintenance.

#### **Security Hardening**
*   **SSH Hardening**: Modifies the `sshd_config` to disable root login, password authentication, and X11 forwarding, enforcing public key authentication only.
*   **Firewall (firewalld)**:
    *   Enables and starts the firewall service.
    *   Opens standard ports for SSH, HTTP, and HTTPS, plus an additional custom port (9091/tcp).
    *   Explicitly blocks high-risk ports like RDP (3389) and VNC (5900-5910).
*   **Fail2ban**: Deploys custom filters and a jail configuration to automatically ban IPs that fail authentication attempts against services.
*   **SELinux**:
    *   Sets the system-wide policy to `enforcing`.
    *   Sets necessary booleans (`container_manage_cgroup`, `container_use_devices`) to allow containers to function correctly.
    *   Installs a custom SELinux policy module (`podman_libc_read`) to fix potential permission issues with rootless Podman.
*   **Automatic Updates**: Configures `dnf-automatic` to automatically apply security updates.

#### **Rootless Podman & Container Environment**
*   **System Configuration**:
    *   Enables user lingering for the `podman_user`, allowing their services to run even when they are not logged in.
    *   Configures `sysctl` to allow rootless containers to bind to privileged ports below 1024 (e.g., 80, 443).
    *   Configures `journald` for persistent logging.
*   **Podman Configuration**:
    *   Creates configuration files (`containers.conf`, `storage.conf`) for the `podman_user`.
    *   Sets `crun` as the default runtime and explicitly enables SELinux support.
    *   Configures Podman's storage (`graphroot`) to use the dedicated data disk, separating container images and volumes from the OS disk.
*   **Systemd Integration**:
    *   Sets up and enables a systemd user socket (`podman.socket`) for the Podman API service, allowing for Docker-like remote management.
    *   Configures Podman Quadlet, enabling `systemd` to automatically generate and manage user services directly from container definition files.
*   **Directory & Permission Setup**:
    *   Creates a structured directory layout under `container_base_path` for configs, compose files, volumes, and logs.
    *   Applies the correct SELinux contexts (`container_home_t`, `container_var_lib_t`) to all Podman-related directories to ensure proper isolation and permissions.
    *   Sets file access control lists (ACLs) to ensure the `podman_user` has appropriate permissions.
*   **Validation**:
    *   Runs `podman info` as the `podman_user` to validate that the entire rootless environment is configured correctly.
    *   Logs into the GitHub Container Registry (ghcr.io) using provided credentials.

#### **Finalization**
*   **Service Management**: Ensures core services like `sshd`, `firewalld`, and `fail2ban` are enabled and running.
*   **Pre-Reboot Checks**: Performs a series of safety checks to ensure the server will be accessible after a reboot, including verifying SSH firewall rules, SSH configuration syntax, and the existence of the admin's authorized keys file.
*   **Reboot**: Performs a final reboot to apply all core system changes.

---

### Backup and Restore Operations

These tasks handle the creation, scheduling, and restoration of server backups using `rclone`.

*   **Rclone Setup**:
    *   Installs the `rclone` utility.
    *   Deploys a secure configuration file for the `podman_user`, enabling it to connect to a specified cloud storage provider (e.g., Mega).

*   **Manual Backup (`--tags backup`)**:
    *   Creates a single compressed tarball (`.tar.gz`) of critical system and application data paths.
    *   Uploads the backup archive to the configured cloud storage.
    *   Cleans up the local archive file after a successful upload.

*   **Automatic Scheduled Backup (`--tags autobackup`)**:
    *   If enabled, deploys a backup script to `/usr/local/bin/`.
    *   Creates a cron job for the `podman_user` that runs the backup script on a configurable schedule (e.g., daily at 2:00 AM).

*   **System Restore (`--tags restore`)**:
    *   Triggered by specifying a backup filename.
    *   Stops running services to prevent data corruption.
    *   Downloads the specified backup archive from cloud storage.
    *   Cleans the existing Podman storage directory for a clean slate.
    *   Extracts the archive's contents to the root (`/`) of the filesystem, restoring all backed-up files.
    *   Re-applies the correct file ownership and SELinux contexts to all restored data.
    *   Automatically discovers all Podman Compose files in the restored directories and starts all container services using `podman-compose up -d`.
    *   Cleans up the downloaded archive and restarts critical services like SSH.