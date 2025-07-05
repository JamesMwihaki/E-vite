const SelectedUsers = ({selectedUsers}) => (
     <>
        <div>|           -- SELECTED USERS --             |</div>
        <div>|                                            |</div>
        {selectedUsers.length > 0 ? (
            selectedUsers.map(user => (
                <div key={user.id}>| [>] {user.name} ({user.username})</div>
            ))
        ) : (
            <div>|            [No users selected]             |</div>
        )}
        <div>|                                            |</div>
    </>
);

export default SelectedUsers;