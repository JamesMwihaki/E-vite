const FormField = ({ label, children }) => (
    <>
        <div>|  {label.padEnd(42)}|</div>
        <div>|  +--------------------------------------+  |</div>
        <div>    {children}             </div>
        <div>|  +--------------------------------------+  |</div>
        <div>|                                            |</div>
    </>
);

export default FormField;