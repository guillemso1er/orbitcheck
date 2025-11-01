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