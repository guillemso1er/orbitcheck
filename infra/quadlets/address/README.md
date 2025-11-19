
# Address Service

## Dockerfile

### Base Image

### Both architectures

```
podman build  -f libpostal.base.Dockerfile --platform linux/amd64,linux/arm64 --manifest ghcr.io/guillemso1er/orbitcheck/libpostal-base:latest .
  ```

### Arm64 Image


#### Build

```
podman build  -f libpostal.base.Dockerfile --platform linux/arm64 --manifest ghcr.io/guillemso1er/orbitcheck/libpostal-base:latest .

 ```
 ### X86_64 Image

 #### Build

```
podman build  -f libpostal.base.Dockerfile --platform linux/amd64 --manifest ghcr.io/guillemso1er/orbitcheck/libpostal-base:latest .
 ```


### Manifest/Image push

```
podman manifest push ghcr.io/guillemso1er/orbitcheck/libpostal-base:latest
```
