import ts, { factory as f } from "typescript";
import { ZodSchemaResult } from "../config";

export function createOptionalProperty(
  name: string,
  zodImportValue: string
): ts.PropertyAssignment {
  const anyType = f.createCallExpression(
    f.createPropertyAccessExpression(
      f.createIdentifier(zodImportValue),
      f.createIdentifier("any")
    ),
    undefined,
    undefined
  );

  return f.createPropertyAssignment(
    name,
    f.createCallExpression(
      f.createPropertyAccessExpression(anyType, f.createIdentifier("optional")),
      undefined,
      undefined
    )
  );
}

export function createObjectSchemaStatement(
  varName: string,
  properties: ts.PropertyAssignment[],
  zodImportValue: string
): ts.VariableStatement {
  return f.createVariableStatement(
    undefined,
    f.createVariableDeclarationList(
      [
        f.createVariableDeclaration(
          varName,
          undefined,
          undefined,
          f.createCallExpression(
            f.createPropertyAccessExpression(
              f.createIdentifier(zodImportValue),
              f.createIdentifier("object")
            ),
            undefined,
            [f.createObjectLiteralExpression(properties, true)]
          )
        ),
      ],
      ts.NodeFlags.Const
    )
  );
}

export function createFallbackSchema(varName: string): ZodSchemaResult {
  return {
    dependencies: [],
    statement: f.createVariableStatement(
      undefined,
      f.createVariableDeclarationList(
        [f.createVariableDeclaration(varName)],
        ts.NodeFlags.Const
      )
    ),
    enumImport: false,
  };
}
