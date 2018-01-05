export {};

declare namespace JSX {
    interface ElementClass {
        render: any;
    }
}

/** @deprecated */
function FooComponent(props: {foo: string}): false;
function FooComponent(props: {bar: number}): false;
function FooComponent() {
    return false;
}

class BarComponent {
    render() {
        return false;
    }
}

/** @deprecated */
class BazComponent extends BarComponent {}

let foo = <FooComponent foo="a"/>;
let foo2 = <FooComponent bar="1"></FooComponent>;
let bar = <BarComponent></BarComponent>;
let baz = <BazComponent></BazComponent>;
