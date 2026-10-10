"""Le skin di League importate nel gioco: campione e numero di skin di LoL, scala, mani armate e
armi (pezzi della mesh, impugnatura e assi nelle coordinate del gioco prima della scala).

`tail`: ciocca o coda (metri di LoL) che diventa una catena verlet appesa alla testa, abbassata
di `down` gradi prima della T-pose.

`grip`: mani che impugnano un'arma (dita chiuse); la mano libera segue le clip.

Arma: `grip` = punto dove la mano la stringe, `axis` = verso la punta (diventa +Z del perno
dell'arma, come la lama delle katane di Nova), `up` = verso il dorso (+Y del perno), `size` =
lunghezza finale in metri lungo `axis` (facoltativa: altrimenti scala del campione).

`scale` porta le unità di LoL a metri (altezza naturale del personaggio). Le clip dei campioni
importati (src/champions/lolAnims.ts) sono scritte per bodySpec('female') e si adattano al corpo
con animScale (spalle del modello / spalle di quel corpo, vedi lolAnimScale).
"""

SKINS = {
    'akali': {
        'champ': 'akali', 'skin': 15, 'name': 'True Damage Akali', 'grip': ['L', 'R'],
        'scale': 0.82, 'female': True, 'bulk': 0.86,
        'weapons': {
            'R': {'subs': ['kama_left', 'kama_grip'], 'grip': [-1.41, 0.025, -0.17], 'axis': [0, 0, 1], 'up': [1, 0, 0]},
            'L': {'subs': ['kunai_hand'], 'grip': [-1.159, 0.005, -0.01], 'axis': [0, 0, 1], 'up': [1, 0, 0], 'size': 0.62},
        },
        # coda di cavallo: nel bind è orizzontale; la abbasso e la rendo una catena appesa alla testa
        'tail': {'root': [0.0, 1.903, -0.095], 'dir': [0, 0, -1], 'length': 0.56, 'bones': 3, 'down': 55},
    },
    'qiyana': {
        'champ': 'qiyana', 'skin': 2, 'name': 'True Damage Qiyana', 'grip': ['R'],
        'scale': 0.88, 'female': True, 'bulk': 0.84,
        'weapons': {
            # anello: impugnatura sul tratto in cuoio tra la lama in alto e quella a destra
            'R': {'subs': ['weapon_default'], 'ring': {'grip_deg': 52}, 'size': 0.8},
        },
    },
    'locke': {
        'champ': 'locke', 'skin': 0, 'name': 'Locke', 'grip': ['L', 'R'],
        'scale': 0.87, 'female': False, 'bulk': 1.0,
        # la cassa appesa davanti alle gambe arriva a terra: nel gioco attraverserebbe gambe e suolo
        'hide': ['Case'],
        'weapons': {
            'R': {'subs': ['Weapon'], 'grip': [0.0, 0.0, 0.13], 'axis': [0, 0, -1], 'up': [0, 1, 0]},
            'L': {'subs': ['Nail'], 'grip': [-0.169, 0.0, 0.13], 'axis': [0, 0, -1], 'up': [0, 1, 0]},
        },
    },
}
