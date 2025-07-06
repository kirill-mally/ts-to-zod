import { Command, Flags, Args, Interfaces } from "@oclif/core";
import chokidar from "chokidar";
import { existsSync, outputFile, readFile } from "fs-extra";
import inquirer from "inquirer";
import ora from "ora";
import path, { join, normalize, parse } from "path";
import prettier from "prettier";
import slash from "slash";
import ts from "typescript";
import { GenerateProps, generate } from "./core/generate";
import { createConfig } from "./createConfig";
import {
  areImportPathsEqualIgnoringExtension,
  getImportPath,
  getInputOutputMappings,
} from "./utils/getImportPath";
import * as worker from "./worker";
import { MaybeConfig, State, TsToZodConfig, Config } from "./config";
import {
  getSchemaNameSchema,
  nameFilterSchema,
  tsToZodConfigSchema,
} from "./config.zod";

let config: TsToZodConfig | undefined;
let haveMultiConfig = false;
const configKeys: string[] = [];

function isEsm() {
  try {
    const packageJsonPath = join(process.cwd(), "package.json");
    const rawPackageJson = require(
      slash(path.relative(__dirname, packageJsonPath))
    );
    return rawPackageJson.type === "module";
  } catch (e) {}
  return false;
}

const fileExtension = isEsm() ? "cjs" : "js";
const tsToZodConfigFileName = `ts-to-zod.config.${fileExtension}`;
const configPath = join(process.cwd(), tsToZodConfigFileName);

try {
  if (existsSync(configPath)) {
    const rawConfig = require(slash(path.relative(__dirname, configPath)));
    config = tsToZodConfigSchema.parse(rawConfig);
    if (Array.isArray(config)) {
      haveMultiConfig = true;
      configKeys.push(...config.map((c) => c.name));
    }
  }
} catch (e) {
  if (e instanceof Error) {
    throw new Error(
      `"${tsToZodConfigFileName}" invalid:\n${e.message}\nPlease fix the invalid configuration\nYou can generate a new config with --init`
    );
  }
  process.exit(2);
}

export default class TsToZod extends Command {
  static description = "Generate Zod schemas from a Typescript file";

  static examples = [`$ ts-to-zod src/types.ts src/types.zod.ts`];

  static usage = haveMultiConfig
    ? [
        "--all",
        ...configKeys.map(
          (key) => `--config ${key.includes(" ") ? `"${key}"` : key}`
        ),
      ]
    : undefined;

  static flags = {
    version: Flags.version({ char: "v" }),
    help: Flags.help({ char: "h" }),
    keepComments: Flags.boolean({
      char: "k",
      description: "Keep parameters comments",
    }),
    init: Flags.boolean({
      char: "i",
      description: `Create a ${tsToZodConfigFileName} file`,
    }),
    skipParseJSDoc: Flags.boolean({
      default: false,
      description: "Skip the creation of zod validators from JSDoc annotations",
    }),
    skipValidation: Flags.boolean({
      default: false,
      description: "Skip the validation step (not recommended)",
    }),
    inferredTypes: Flags.string({
      description: "Path of z.infer<> types file",
    }),
    watch: Flags.boolean({
      char: "w",
      default: false,
      description: "Watch input file(s) for changes and re-run related task",
    }),
    config: Flags.string({
      char: "c",
      options: configKeys,
      description: "Execute one config",
      hidden: !haveMultiConfig,
    }),
    all: Flags.boolean({
      char: "a",
      default: false,
      description: "Execute all configs",
      hidden: !haveMultiConfig,
    }),
  };

  static args = {
    input: Args.file({ description: "input file (typescript)" }),
    output: Args.file({ description: "output file (zod schemas)" }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(TsToZod);

    if (flags.init) {
      const created = await createConfig(configPath, tsToZodConfigFileName);
      this.log(
        created ? `🧐 ${tsToZodConfigFileName} created!` : `Nothing changed!`
      );
      return;
    }

    const fileConfig = await this.loadFileConfig(config, flags);

    if (Array.isArray(fileConfig)) {
      if (args.input || args.output) {
        this.error(`INPUT and OUTPUT arguments are not compatible with --all`);
      }
      try {
        await Promise.all(
          fileConfig.map(async (conf) => {
            this.log(`Generating "${conf.name}"`);
            const result = await this.generate(args, conf, flags);
            if (result.success) {
              this.log(`🎉 Zod schemas generated!`);
            } else {
              this.error(result.error, { exit: false });
            }
            this.log(); // empty line between configs
          })
        );
      } catch (e) {
        this.error(`${e}`, { exit: false });
      }
    } else {
      const result = await this.generate(args, fileConfig, flags);
      if (result.success) {
        this.log(`🎉 Zod schemas generated!`);
      } else {
        this.error(result.error);
      }
    }

    if (flags.watch) {
      const inputs = Array.isArray(fileConfig)
        ? fileConfig.map((i) => i.input)
        : fileConfig?.input || args.input || [];

      this.log("\nWatching for changes…");
      chokidar.watch(inputs).on("change", async (path) => {
        console.clear();
        this.log(`Changes detected in "${slash(path)}"`);
        const conf = Array.isArray(fileConfig)
          ? fileConfig.find((i) => i.input === slash(path))
          : fileConfig;

        const result = await this.generate(args, conf, flags);
        if (result.success) {
          this.log(`🎉 Zod schemas generated!`);
        } else {
          this.error(result.error);
        }
        this.log("\nWatching for changes…");
      });
    }
  }

  async generate(
    args: { input?: string; output?: string },
    fileConfig: Config | undefined,
    flags: Interfaces.InferredFlags<typeof TsToZod.flags>
  ): Promise<{ success: true } | { success: false; error: string }> {
    const input = args.input || fileConfig?.input;
    const output = args.output || fileConfig?.output;

    if (!input) {
      return {
        success: false,
        error: `Missing 1 required arg:
${TsToZod.args.input.description}
See more help with --help`,
      };
    }

    const inputPath = join(process.cwd(), input);
    const outputPath = join(process.cwd(), output || input);

    const relativeIOMappings = getInputOutputMappings(fileConfig);

    // Validate file extensions
    const extErrors: { path: string; expectedExtensions: string[] }[] = [];
    const typescriptExtensions = [".ts", ".tsx"];
    const javascriptExtensions = [".js", ".jsx"];

    if (!typescriptExtensions.some((ext) => input.endsWith(ext))) {
      extErrors.push({ path: input, expectedExtensions: typescriptExtensions });
    }
    if (
      output &&
      ![...typescriptExtensions, ...javascriptExtensions].some((ext) =>
        output.endsWith(ext)
      )
    ) {
      extErrors.push({
        path: output,
        expectedExtensions: [...typescriptExtensions, ...javascriptExtensions],
      });
    }

    if (extErrors.length) {
      return {
        success: false,
        error: `Unexpected file extension:\n${extErrors
          .map(
            ({ path, expectedExtensions }) =>
              `"${path}" must be ${expectedExtensions
                .map((i) => `"${i}"`)
                .join(", ")}`
          )
          .join("\n")}`,
      };
    }

    const sourceText = await readFile(inputPath, "utf-8");

    // Parse TS SourceFile AST (required for generics support)
    const sourceFile = ts.createSourceFile(
      inputPath,
      sourceText,
      ts.ScriptTarget.Latest,
      true
    );

    // Build maybeConfig from maybeTypeNames if available
    const maybeTypeNamesArray =
      fileConfig?.maybeTypeNames != null &&
      Array.isArray(fileConfig?.maybeTypeNames)
        ? fileConfig?.maybeTypeNames
        : [];
    const maybeConfig: MaybeConfig = {
      optional: true,
      nullable: true,
      typeNames: new Set(maybeTypeNamesArray),
    };

    // Build initial state for generation with genericMap & maybeConfig & sourceFile AST
    const state: State = {
      genericMap: new Map(),
      maybeConfig,
      rawFileAst: sourceFile,
      seenSymbols: new Set(),
      // Include any other properties your State interface requires here
    };

    // Compose generation options
    const generateOptions: GenerateProps = {
      sourceText,
      inputOutputMappings: relativeIOMappings,
      keepComments: flags.keepComments,
      skipParseJSDoc: flags.skipParseJSDoc,
      inferredTypes: flags.inferredTypes,
      state,
      ...fileConfig,
    };

    const {
      errors,
      transformedSourceText,
      getZodSchemasFile,
      getIntegrationTestFile,
      getInferredTypes,
      hasCircularDependencies,
    } = await generate(generateOptions);

    if (hasCircularDependencies && !output) {
      return {
        success: false,
        error:
          "--output= must also be provided when input files have some circular dependencies",
      };
    }

    errors.forEach(this.warn.bind(this));

    if (!flags.skipValidation) {
      const validatorSpinner = ora("Validating generated types").start();
      if (flags.all) validatorSpinner.indent = 1;

      const extraFiles = [];

      for (const io of relativeIOMappings) {
        if (getImportPath(inputPath, io.input) !== "/") {
          try {
            const fileInputPath = join(process.cwd(), io.input);
            const inputFile = await readFile(fileInputPath, "utf-8");
            extraFiles.push({ sourceText: inputFile, relativePath: io.input });
          } catch {
            validatorSpinner.warn(`File "${io.input}" not found`);
          }
          try {
            const fileOutputPath = join(process.cwd(), io.output);
            const outputFile = await readFile(fileOutputPath, "utf-8");
            extraFiles.push({
              sourceText: outputFile,
              relativePath: io.output,
            });
          } catch {
            validatorSpinner.warn(
              `File "${io.output}" not found: maybe it hasn't been generated yet?`
            );
          }
        }
      }

      let outputForValidation = output || "";
      if (!output || areImportPathsEqualIgnoringExtension(input, output)) {
        const outputFileName = "source.zod.ts";
        const { dir } = parse(normalize(input));
        outputForValidation = join(dir, outputFileName);
      }

      const generationErrors = await worker.validateGeneratedTypesInWorker({
        sourceTypes: {
          sourceText: transformedSourceText,
          relativePath: input,
        },
        integrationTests: {
          sourceText: getIntegrationTestFile(
            getImportPath("./source.integration.ts", input),
            getImportPath("./source.integration.ts", outputForValidation)
          ),
          relativePath: "./source.integration.ts",
        },
        zodSchemas: {
          sourceText: getZodSchemasFile(
            getImportPath(outputForValidation, input)
          ),
          relativePath: outputForValidation,
        },
        skipParseJSDoc: Boolean(generateOptions.skipParseJSDoc),
        extraFiles,
      });

      generationErrors.length
        ? validatorSpinner.fail()
        : validatorSpinner.succeed();

      if (generationErrors.length > 0) {
        return { success: false, error: generationErrors.join("\n") };
      }
    }

    // Format and write output files
    const prettierConfig = await prettier.resolveConfig(process.cwd());

    if (generateOptions.inferredTypes) {
      const zodInferredTypesFile = getInferredTypes(
        getImportPath(generateOptions.inferredTypes, outputPath)
      );
      await outputFile(
        generateOptions.inferredTypes,
        await prettier.format(
          hasExtensions(generateOptions.inferredTypes, javascriptExtensions)
            ? ts.transpileModule(zodInferredTypesFile, {
                compilerOptions: {
                  target: ts.ScriptTarget.Latest,
                  module: ts.ModuleKind.ESNext,
                  newLine: ts.NewLineKind.LineFeed,
                },
              }).outputText
            : zodInferredTypesFile,
          { parser: "babel-ts", ...prettierConfig }
        )
      );
    }

    if (output && hasExtensions(output, javascriptExtensions)) {
      await outputFile(
        outputPath,
        await prettier.format(
          ts.transpileModule(
            getZodSchemasFile(getImportPath(outputPath, inputPath)),
            {
              compilerOptions: {
                target: ts.ScriptTarget.Latest,
                module: ts.ModuleKind.ESNext,
                newLine: ts.NewLineKind.LineFeed,
              },
            }
          ).outputText,
          { parser: "babel-ts", ...prettierConfig }
        )
      );
    } else {
      await outputFile(
        outputPath,
        await prettier.format(
          getZodSchemasFile(getImportPath(outputPath, inputPath)),
          { parser: "babel-ts", ...prettierConfig }
        )
      );
    }

    return { success: true };
  }

  async loadFileConfig(
    config: TsToZodConfig | undefined,
    flags: Interfaces.InferredFlags<typeof TsToZod.flags>
  ): Promise<TsToZodConfig | undefined> {
    if (!config) return undefined;

    if (Array.isArray(config)) {
      if (!flags.all && !flags.config) {
        const { mode } = await inquirer.prompt<{
          mode: "none" | "multi" | `single-${string}`;
        }>([
          {
            name: "mode",
            message: `You have multiple configs in "${tsToZodConfigFileName}"\n What do you want?`,
            type: "list",
            choices: [
              {
                value: "multi",
                name: `${TsToZod.flags.all.description} (--all)`,
              },
              ...configKeys.map((key) => ({
                value: `single-${key}`,
                name: `Execute "${key}" config (--config=${key})`,
              })),
              { value: "none", name: "Don't use the config" },
            ],
          },
        ]);
        if (mode.startsWith("single-")) {
          flags.config = mode.slice("single-".length);
        } else if (mode === "multi") {
          flags.all = true;
        }
      }
      if (flags.all) {
        return config;
      }
      if (flags.config) {
        const selectedConfig = config.find((c) => c.name === flags.config);
        if (!selectedConfig) {
          this.error(`${flags.config} configuration not found!`);
        }
        return selectedConfig;
      }
      return undefined;
    }
    return {
      ...config,
      getSchemaName: config.getSchemaName
        ? getSchemaNameSchema.implement(config.getSchemaName)
        : undefined,
      nameFilter: config.nameFilter
        ? nameFilterSchema.implement(config.nameFilter)
        : undefined,
    };
  }
}

function hasExtensions(path: string, extensions: string[]): boolean {
  const { ext } = parse(path);
  return extensions.includes(ext);
}
