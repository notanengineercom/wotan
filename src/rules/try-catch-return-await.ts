import { injectable } from 'inversify';
import { TypedRule, TypedRuleContext, WrappedAst, Replacement } from '../types';
import {
    NodeWrap,
    isFunctionWithBody,
    hasModifier,
    isTryStatement,
    isFunctionScopeBoundary,
    isReturnStatement,
    isParenthesizedExpression,
    isUnionType,
} from 'tsutils';
import * as ts from 'typescript';

@injectable()
export class Rule extends TypedRule {
    public static supports(sourceFile: ts.SourceFile) {
        return !sourceFile.isDeclarationFile;
    }

    private inTryCatch = false;

    constructor(context: TypedRuleContext, private ast: WrappedAst) {
        super(context);
    }

    public apply() {
        return this.iterate(this.ast.next!, undefined, false);
    }

    private iterate(wrap: NodeWrap, end: NodeWrap | undefined, inTryCatch: boolean) {
        do { // iterate as linked list until we find the first labeled statement
            if (isFunctionWithBody(wrap.node) && hasModifier(wrap.node.modifiers, ts.SyntaxKind.AsyncKeyword)) {
                this.inTryCatch = false;
                wrap.children.forEach(this.visitNode, this); // visit children recursively
                this.inTryCatch = inTryCatch;
                wrap = wrap.skip!; // continue right after the function
            } else {
                wrap = wrap.next!;
            }
        } while (wrap !== end);
    }

    private visitNode(wrap: NodeWrap) {
        if (this.inTryCatch) {
            if (isReturnStatement(wrap.node)) {
                if (wrap.node.expression === undefined)
                    return;
                this.checkReturnExpression(wrap.node.expression);
                this.iterate(wrap.next!, wrap.skip, true);
            }
        } else if (isTryStatement(wrap.node)) {
            this.inTryCatch = true;
            wrap.children[0].children.forEach(this.visitNode, this); // Statements in tryBlock
            if (wrap.node.catchClause !== undefined) {
                this.inTryCatch = wrap.node.finallyBlock !== undefined; // special handling for catchClause only if finallyBlock is present
                wrap.children[1].children.forEach(this.visitNode, this); // Children of catchClause
            }
            this.inTryCatch = false;
            if (wrap.node.finallyBlock !== undefined)
                wrap.children[wrap.children.length - 1].children.forEach(this.visitNode, this);
            return;
        }
        if (isFunctionScopeBoundary(wrap.node)) // no longer in async function -> iterate as linked list
            return this.iterate(wrap, wrap.skip, this.inTryCatch);
        return wrap.children.forEach(this.visitNode, this);
    }

    private checkReturnExpression(node: ts.Expression) {
        const {pos} = node;
        while (isParenthesizedExpression(node))
            node = node.expression;
        if (node.kind === ts.SyntaxKind.AwaitExpression)
            return;
        if (this.isPromiseLike(node))
            this.addFailure(
                pos - 'return'.length,
                pos,
                "Missing 'await' of Promise returned inside try-catch.",
                Replacement.append(pos, ' await'),
            );
    }

    private isPromiseLike(node: ts.Expression): boolean {
        const type = this.checker.getApparentType(this.checker.getTypeAtLocation(node));
        const then = type.getProperty('then');
        if (then === undefined)
            return false;
        const thenType = this.checker.getTypeOfSymbolAtLocation(then, node);
        for (const t of isUnionType(thenType) ? thenType.types : [thenType])
            for (const signature of t.getCallSignatures())
                if (signature.parameters.length !== 0 && this.isCallback(signature.parameters[0], node))
                    return true;
        return false;
    }

    private isCallback(param: ts.Symbol, node: ts.Expression): boolean {
        const type = this.checker.getApparentType(this.checker.getTypeOfSymbolAtLocation(param, node));
        for (const t of isUnionType(type) ? type.types : [type])
            if (t.getCallSignatures().length !== 0)
                return true;
        return false;
    }
}