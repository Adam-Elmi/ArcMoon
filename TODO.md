# V1.2.0
## Bugs to be fixed
1. [x] arcm trust `<dir>` causes hash mismatch loop for outside templates:
    - Reproduction:
    When importing components from an outside folder (e.g. ../random), running arcm trust ../random creates an infinite trust loop or fails to build.
    
    ```sh
    # 1. Setup outside folder with 2 components
    mkdir -p random project
    echo '[h1]Button[end]' > random/Button.arcm
    echo '[h1]Modal[end]'  > random/Modal.arcm
    ```
    
    ```sh
    # 2. Project page imports one component
    echo '[import = Btn: "../random/Button.arcm" !][Btn!]' > project/page.arcm
    ```
    
    ```sh
    cd project
    arcm build page.arcm
    # ⚠ Template "../random" is not trusted.
    #   Review it, then run "arcmoon trust ../random".
    ```
    
    ```sh
    # 3. Trust as instructed:
    arcm trust ../random
    # ✓ Trusted "../random" (sha256-button...)
    # ✓ Trusted "../random" (sha256-modal...) <- Overwrites button's hash!
    ```
    
    ```sh
    # 4. Try building again:
    arcm build page.arcm
    # ⚠ Template "../random" has changed since it was trusted.
    #   Review it, then run "arcmoon trust ../random". (Infinite loop)
    ```


## New Features
1. [x] Add built-in utils that you can easily import them. For example: 
  ```js 
  ${
    import { onResize } from "arcmoon/utils"};
  }$
  ```
2. [ ] Add REPL for ArcMoon (In progress)
3. [ ] ArcMoon Packages: Ready-made .arcm files you can drop into any page 