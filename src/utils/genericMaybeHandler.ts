import * as ts from "typescript";
import { factory as f } from "typescript";

export function generateGenericMaybeSchema(
  node: ts.InterfaceDeclaration,
  zodImportValue: string = "z"
): ts.Expression {
  // Create optional properties for all interface members
  const properties = node.members.filter(ts.isPropertySignature).map((prop) => {
    const propName = prop.name.getText();
    return f.createPropertyAssignment(
      propName,
      f.createCallExpression(
        f.createPropertyAccessExpression(
          f.createIdentifier(zodImportValue),
          f.createIdentifier("any")
        ),
        undefined,
        undefined
      )
    );
  });

  // Create the object schema with all properties optional
  return f.createCallExpression(
    f.createPropertyAccessExpression(
      f.createIdentifier(zodImportValue),
      f.createIdentifier("object")
    ),
    undefined,
    [f.createObjectLiteralExpression(properties, true)]
  );
}
