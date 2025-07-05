const ActionButtons = ({ onCreate, onSaveDraft }) => (
    <>
        <div>|    +--------------+   +--------------+     |</div>
        <div>      <button onClick={onCreate}>CREATE EVENT</button>       <button onClick={onSaveDraft}>SAVE DRAFT</button>        </div>
        <div>|    +--------------+   +--------------+     |</div>
    </>
);

export default ActionButtons;