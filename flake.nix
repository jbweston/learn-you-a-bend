{
  description = "Learn You a Bend: an interactive Bend 2 tutorial with runnable browser examples";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    bend.url = "github:bendlang/bend";
    bend.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs = { nixpkgs, bend, ... }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
    in
    {
      apps = forAllSystems (system:
        let
          pkgs = import nixpkgs { inherit system; };
          buildTutorial = pkgs.writeShellApplication {
            name = "learn-you-a-bend-build";
            runtimeInputs = [ pkgs.python3 pkgs.pandoc pkgs.esbuild bend.packages.${system}.default ];
            text = ''
              export BEND_SOURCE=${bend.outPath}
              exec python3 src/build.py
            '';
          };
          # Bundle the PDF engine, packages, and Unicode fonts: no TeX downloads
          # are needed when rendering, unlike Tectonic's on-demand bundle fetches.
          exportTex = pkgs.texliveSmall.withPackages (tex: with tex; [
            luatex luaotfload lualatex-math fontspec unicode-math selnolig bookmark microtype
            fvextra framed upquote xurl soul footnotehyper
          ]);
          exportTutorial = format: pkgs.writeShellApplication {
            name = "learn-you-a-bend-${format}";
            runtimeInputs = [ pkgs.python3 pkgs.pandoc ]
              ++ pkgs.lib.optionals (format == "pdf") [ exportTex ];
            text = pkgs.lib.optionalString (format == "pdf") ''
              export FONTCONFIG_FILE=${pkgs.makeFontsConf { fontDirectories = [ pkgs.dejavu_fonts ]; }}
            '' + ''
              exec python3 src/export.py ${format} "$@"
            '';
          };
          serveTutorial = pkgs.writeShellApplication {
            name = "learn-you-a-bend-serve";
            runtimeInputs = [ pkgs.python3 ]
              ++ pkgs.lib.optionals pkgs.stdenv.hostPlatform.isLinux [ pkgs.xdg-utils ];
            text = ''exec python3 src/serve.py "$@"'';
          };
        in
        {
          build = {
            type = "app";
            program = "${buildTutorial}/bin/learn-you-a-bend-build";
          };
          pdf = {
            type = "app";
            program = "${exportTutorial "pdf"}/bin/learn-you-a-bend-pdf";
          };
          epub = {
            type = "app";
            program = "${exportTutorial "epub"}/bin/learn-you-a-bend-epub";
          };
          serve = {
            type = "app";
            program = "${serveTutorial}/bin/learn-you-a-bend-serve";
          };
          just = {
            type = "app";
            program = "${pkgs.just}/bin/just";
          };
          pandoc = {
            type = "app";
            program = "${pkgs.pandoc}/bin/pandoc";
          };
          esbuild = {
            type = "app";
            program = "${pkgs.esbuild}/bin/esbuild";
          };
          python = {
            type = "app";
            program = "${pkgs.python3}/bin/python3";
          };
          node = {
            type = "app";
            program = "${pkgs.nodejs}/bin/node";
          };
          bend = {
            type = "app";
            program = "${bend.packages.${system}.default}/bin/bend";
          };
        } // pkgs.lib.optionalAttrs pkgs.stdenv.hostPlatform.isLinux {
          xdg-open = {
            type = "app";
            program = "${pkgs.xdg-utils}/bin/xdg-open";
          };
        });

      devShells = forAllSystems (system:
        let
          pkgs = import nixpkgs { inherit system; };
        in
        {
          default = pkgs.mkShell {
            name = "learn-you-a-bend";
            packages = [
              bend.packages.${system}.default
              pkgs.git
              pkgs.just
              pkgs.pandoc
              pkgs.python3
              pkgs.nodejs
              pkgs.esbuild
            ] ++ pkgs.lib.optionals pkgs.stdenv.hostPlatform.isLinux [
              pkgs.xdg-utils
            ];
          };
        });
    };
}
